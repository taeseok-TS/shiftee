import { prisma } from "@/lib/db";
import { leaveLabel } from "@/lib/leave-catalog";
import { KIND_LABEL as ATT_KIND_LABEL } from "@/lib/attendance-request";

// ─── 요청 한눈에(2026-10-07 QA76 묶음 9: #51 #43 #76) ─────────────────────
// 휴가·휴가 취소·근무일정·출퇴근 요청을 한 목록으로. 진행(결재 n/N)·마지막 의견·반려 사유를 함께 준다.
//  · mine    : 내가 올린 요청(#51)
//  · decided : 내가 결재한 요청(#43 「완료」) — 결재 단계에서 내가 **직접** 승인·반려한 것, 출퇴근 요청은 내가 처리한 것
// 기간(from~to, KST 날짜)은 요청을 올린 날 기준, 상태는 DB 에서 거르고, q 는 제목·요청자·기간·사유·의견에서 찾는다(#76).
// 종류마다 최근 300건까지 읽는다(넘으면 limited=true — 화면이 「기간을 좁혀 주세요」를 띄운다).
export type FeedItem = {
  kind: "LEAVE" | "LEAVE_CANCEL" | "SCHEDULE" | "ATTENDANCE";
  id: string;
  title: string;
  period: string;
  requester: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  reason: string | null;
  progress: { done: number; total: number } | null;
  lastComment: { by: string; text: string } | null;
  rejectReason: string | null;
  myDecision?: "APPROVED" | "REJECTED";
};

export type FeedQuery = { from?: string | null; to?: string | null; status?: string | null; q?: string | null; kind?: string | null };

const KST = 9 * 3600 * 1000;
const PER_KIND = 300;
const MAX_ITEMS = 500;
const utcYmd = (d: Date) => d.toISOString().slice(0, 10);   // @db.Date 는 UTC 자정
const range = (s: Date, e: Date) => (utcYmd(s) === utcYmd(e) ? utcYmd(s) : `${utcYmd(s)} ~ ${utcYmd(e)}`);
const okYmd = (v?: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number(v.slice(0, 4)) >= 2000 && (() => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; })();
const SCHED_KIND: Record<string, string> = { CREATE: "근무일정 신청", UPDATE: "근무일정 수정", DELETE: "근무일정 삭제" };
const STATUSES = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"] as const;

// 시스템이 닫은 단계 — 사람이 결재한 게 아니다. 단계에 결재자가 **미리 박힌**(메인 원장 등) 채로 닫히므로
// approverId 만 보면 「내가 반려」로 잘못 뜬다(2026-10-07 검증 적발). 문구는 닫는 곳과 같아야 한다:
//   신청 취소 = leave/[id]·schedule-requests/[id] DELETE, 요청 철회 = leave/cancel-requests/[id] DELETE, 기한 만료 = leave-cancel-flow
// 반려 때 남은 WAITING 단계를 함께 닫는 것은 decidedAt 이 비어 있어 decidedAt 조건으로 빠진다.
export const SYSTEM_CLOSE_COMMENTS = ["신청 취소", "요청 철회", "기한 만료"];
const isSystemComment = (c: string | null) => !!c && SYSTEM_CLOSE_COMMENTS.includes(c);

function createdRange(q: FeedQuery): { gte?: Date; lt?: Date } | undefined {
  const r: { gte?: Date; lt?: Date } = {};
  if (okYmd(q.from)) r.gte = new Date(new Date(`${q.from}T00:00:00Z`).getTime() - KST);
  if (okYmd(q.to)) r.lt = new Date(new Date(`${q.to}T00:00:00Z`).getTime() - KST + 86400000);
  return r.gte || r.lt ? r : undefined;
}

type Step = { status: string; comment: string | null; decidedAt: Date | null; approver: { name: string } | null; approverId?: string | null };
/** 사람이 실제로 승인·반려한 단계인가 */
const isRealDecision = (s: Step) => (s.status === "APPROVED" || s.status === "REJECTED") && !!s.decidedAt && !isSystemComment(s.comment);
const progressOf = (steps: Step[]) => (steps.length ? { done: steps.filter((s) => s.status === "APPROVED").length, total: steps.length } : null);
const lastCommentOf = (steps: Step[]) => {
  const s = steps.filter((x) => x.comment && isRealDecision(x)).sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())[0];
  return s ? { by: s.approver?.name ?? "결재자", text: s.comment! } : null;
};
const myDecisionOf = (steps: Step[], userId: string) =>
  steps.filter((s) => s.approverId === userId && isRealDecision(s)).sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())[0]?.status as "APPROVED" | "REJECTED" | undefined;
const normStatus = (s: string): FeedItem["status"] => (s === "APPROVED" || s === "REJECTED" || s === "CANCELLED" ? s : "PENDING");

const stepSel = { select: { status: true, comment: true, decidedAt: true, approverId: true, approver: { select: { name: true } } }, orderBy: { order: "asc" as const } };

/** 요청 목록 — who=mine: 내가 올린 것 / who=decided: 내가 결재한 것. limited=true 면 어느 종류든 300건에서 잘렸다 */
export async function requestFeed(userId: string, who: "mine" | "decided", q: FeedQuery): Promise<{ items: FeedItem[]; limited: boolean }> {
  const created = createdRange(q);
  const st = STATUSES.find((s) => s === q.status) ?? null;
  const want = (k: FeedItem["kind"]) => !q.kind || q.kind === k;
  // 공통 조건: 기간·상태, 지워진 직원의 요청은 빼고
  const base = { ...(created ? { createdAt: created } : {}), ...(st ? { status: st } : {}), user: { deletedAt: null } };
  const mineWhere = { userId };
  // 결재한 것 — 내가 직접 승인·반려한 단계가 있는 요청(시스템이 닫은 단계·대기 중인 내 차례는 빼고)
  const decidedStep = { some: {
    approverId: userId, status: { in: ["APPROVED" as const, "REJECTED" as const] }, decidedAt: { not: null },
    OR: [{ comment: null }, { comment: { notIn: SYSTEM_CLOSE_COMMENTS } }],
  } };
  const items: FeedItem[] = [];
  let limited = false;
  const note = (n: number) => { if (n >= PER_KIND) limited = true; };

  if (want("LEAVE")) {
    const rows = await prisma.leaveRequest.findMany({
      where: { ...base, ...(who === "mine" ? mineWhere : { approvalSteps: decidedStep }) },
      select: { id: true, type: true, startDate: true, endDate: true, days: true, status: true, reason: true, rejectedReason: true, createdAt: true,
        user: { select: { name: true } }, approvalSteps: stepSel },
      orderBy: { createdAt: "desc" }, take: PER_KIND,
    });
    note(rows.length);
    for (const r of rows) items.push({
      kind: "LEAVE", id: r.id, title: `${leaveLabel(r.type)} ${r.days}일`, period: range(r.startDate, r.endDate), requester: r.user.name,
      status: normStatus(r.status), createdAt: r.createdAt.toISOString(), reason: r.reason ?? null,
      progress: progressOf(r.approvalSteps), lastComment: lastCommentOf(r.approvalSteps), rejectReason: r.rejectedReason ?? null,
      myDecision: who === "decided" ? myDecisionOf(r.approvalSteps, userId) : undefined,
    });
  }
  if (want("LEAVE_CANCEL")) {
    const rows = await prisma.leaveCancelRequest.findMany({
      where: { ...base, ...(who === "mine" ? mineWhere : { approvalSteps: decidedStep }) },
      select: { id: true, status: true, reason: true, rejectedReason: true, createdAt: true, user: { select: { name: true } },
        leaveRequest: { select: { type: true, startDate: true, endDate: true } }, approvalSteps: stepSel },
      orderBy: { createdAt: "desc" }, take: PER_KIND,
    });
    note(rows.length);
    for (const r of rows) items.push({
      kind: "LEAVE_CANCEL", id: r.id, title: `휴가 취소 — ${leaveLabel(r.leaveRequest.type)}`, period: range(r.leaveRequest.startDate, r.leaveRequest.endDate),
      requester: r.user.name, status: normStatus(r.status), createdAt: r.createdAt.toISOString(), reason: r.reason ?? null,
      progress: progressOf(r.approvalSteps), lastComment: lastCommentOf(r.approvalSteps), rejectReason: r.rejectedReason ?? null,
      myDecision: who === "decided" ? myDecisionOf(r.approvalSteps, userId) : undefined,
    });
  }
  if (want("SCHEDULE")) {
    const rows = await prisma.scheduleRequest.findMany({
      where: { ...base, ...(who === "mine" ? mineWhere : { approvalSteps: decidedStep }) },
      select: { id: true, kind: true, templateName: true, startDate: true, endDate: true, status: true, reason: true, createdAt: true,
        user: { select: { name: true } }, approvalSteps: stepSel },
      orderBy: { createdAt: "desc" }, take: PER_KIND,
    });
    note(rows.length);
    for (const r of rows) {
      // 근무일정은 요청에 반려 사유 칸이 없다 — 사람이 의견을 남기고 반려한 단계에서 가져온다
      const rej = [...r.approvalSteps].reverse().find((s) => s.status === "REJECTED" && s.comment && isRealDecision(s));
      items.push({
        kind: "SCHEDULE", id: r.id, title: `${SCHED_KIND[r.kind] ?? "근무일정 신청"}${r.templateName ? ` · ${r.templateName}` : ""}`, period: range(r.startDate, r.endDate),
        requester: r.user.name, status: normStatus(String(r.status)), createdAt: r.createdAt.toISOString(), reason: r.reason ?? null,
        progress: progressOf(r.approvalSteps), lastComment: lastCommentOf(r.approvalSteps), rejectReason: rej?.comment ?? null,
        myDecision: who === "decided" ? myDecisionOf(r.approvalSteps, userId) : undefined,
      });
    }
  }
  // 출퇴근 요청은 단계가 없다 — decidedBy 가 처리한 사람(본인 취소·자동 취소는 CANCELLED 라 decided 에 안 든다)
  if (want("ATTENDANCE") && !(who === "decided" && (st === "PENDING" || st === "CANCELLED"))) {
    const decidedWhere = { decidedBy: userId, status: st ?? { in: ["APPROVED", "REJECTED"] } };
    const rows = await prisma.attendanceRequest.findMany({
      where: { ...base, ...(who === "mine" ? mineWhere : decidedWhere) },
      select: { id: true, kind: true, action: true, workDate: true, status: true, reason: true, rejectReason: true, decidedBy: true, createdAt: true, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" }, take: PER_KIND,
    });
    note(rows.length);
    const deciders = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.decidedBy).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    for (const r of rows) items.push({
      kind: "ATTENDANCE", id: r.id,
      title: `${(ATT_KIND_LABEL as Record<string, string>)[r.kind] ?? "출퇴근 요청"}${r.action === "IN" ? " · 출근" : r.action === "OUT" ? " · 퇴근" : ""}`,
      period: utcYmd(r.workDate), requester: r.user.name, status: normStatus(r.status), createdAt: r.createdAt.toISOString(), reason: r.reason ?? null,
      progress: { done: r.status === "APPROVED" ? 1 : 0, total: 1 },
      lastComment: r.decidedBy && r.status === "REJECTED" && r.rejectReason ? { by: deciders.get(r.decidedBy) ?? "결재자", text: r.rejectReason } : null,
      rejectReason: r.status === "REJECTED" ? r.rejectReason ?? null : null,
      myDecision: who === "decided" && (r.status === "APPROVED" || r.status === "REJECTED") ? r.status : undefined,
    });
  }

  // 검색(#76) — 제목·요청자·기간·사유·마지막 의견·반려 사유에서, 대소문자 무시
  const term = (q.q || "").trim().toLowerCase();
  const found = items
    .filter((i) => !term || [i.title, i.requester, i.period, i.reason ?? "", i.lastComment?.text ?? "", i.rejectReason ?? ""].some((v) => v.toLowerCase().includes(term)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (found.length > MAX_ITEMS) limited = true;
  return { items: found.slice(0, MAX_ITEMS), limited };
}
