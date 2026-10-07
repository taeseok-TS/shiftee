import { prisma } from "@/lib/db";
import { leaveLabel } from "@/lib/leave-catalog";
import { KIND_LABEL as ATT_KIND_LABEL } from "@/lib/attendance-request";

// ─── 요청 한눈에(2026-10-07 QA76 묶음 9: #51 #43 #76) ─────────────────────
// 휴가·휴가 취소·근무일정·출퇴근 요청을 한 목록으로. 진행(결재 n/N)·마지막 의견·반려 사유를 함께 준다.
//  · mine    : 내가 올린 요청(#51)
//  · decided : 내가 결재한 요청(#43 「완료」) — 결재 단계에 내가 승인·반려로 남은 것, 출퇴근 요청은 내가 처리한 것
// 기간(from~to, KST 날짜)은 요청을 올린 날 기준, q 는 제목·요청자 이름·사유에서 찾는다(#76).
export type FeedItem = {
  kind: "LEAVE" | "LEAVE_CANCEL" | "SCHEDULE" | "ATTENDANCE";
  id: string;
  title: string;
  period: string;
  requester: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  createdAt: string;
  progress: { done: number; total: number } | null;
  lastComment: { by: string; text: string } | null;
  rejectReason: string | null;
  myDecision?: "APPROVED" | "REJECTED";
};

export type FeedQuery = { from?: string | null; to?: string | null; status?: string | null; q?: string | null; kind?: string | null };

const KST = 9 * 3600 * 1000;
const utcYmd = (d: Date) => d.toISOString().slice(0, 10);   // @db.Date 는 UTC 자정
const range = (s: Date, e: Date) => (utcYmd(s) === utcYmd(e) ? utcYmd(s) : `${utcYmd(s)} ~ ${utcYmd(e)}`);
const okYmd = (v?: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && (() => { const d = new Date(`${v}T00:00:00Z`); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v; })();
const SCHED_KIND: Record<string, string> = { CREATE: "근무일정 신청", UPDATE: "근무일정 수정", DELETE: "근무일정 삭제" };

function createdRange(q: FeedQuery): { gte?: Date; lt?: Date } | undefined {
  const r: { gte?: Date; lt?: Date } = {};
  if (okYmd(q.from)) r.gte = new Date(new Date(`${q.from}T00:00:00Z`).getTime() - KST);
  if (okYmd(q.to)) r.lt = new Date(new Date(`${q.to}T00:00:00Z`).getTime() - KST + 86400000);
  return r.gte || r.lt ? r : undefined;
}

type Step = { status: string; comment: string | null; decidedAt: Date | null; approver: { name: string } | null; approverId?: string | null };
const progressOf = (steps: Step[]) => (steps.length ? { done: steps.filter((s) => s.status === "APPROVED").length, total: steps.length } : null);
const lastCommentOf = (steps: Step[]) => {
  const s = [...steps].filter((x) => x.comment && x.decidedAt).sort((a, b) => b.decidedAt!.getTime() - a.decidedAt!.getTime())[0];
  return s ? { by: s.approver?.name ?? "결재자", text: s.comment! } : null;
};
const normStatus = (s: string): FeedItem["status"] => (s === "APPROVED" || s === "REJECTED" || s === "CANCELLED" ? s : "PENDING");

const stepSel = { select: { status: true, comment: true, decidedAt: true, approverId: true, approver: { select: { name: true } } }, orderBy: { order: "asc" as const } };

/** 요청 목록 — who=mine: 내가 올린 것 / who=decided: 내가 결재한 것 */
export async function requestFeed(userId: string, who: "mine" | "decided", q: FeedQuery): Promise<FeedItem[]> {
  const created = createdRange(q);
  const want = (k: FeedItem["kind"]) => !q.kind || q.kind === k;
  const mineWhere = { userId };
  // 결재한 것 — 단계에 내가 승인·반려로 남은 요청(대기 중인 내 차례는 결재함에 있다)
  const decidedStep = { some: { approverId: userId, status: { in: ["APPROVED" as const, "REJECTED" as const] } } };
  const items: FeedItem[] = [];

  if (want("LEAVE")) {
    const rows = await prisma.leaveRequest.findMany({
      where: { ...(who === "mine" ? mineWhere : { approvalSteps: decidedStep }), ...(created ? { createdAt: created } : {}) },
      select: { id: true, type: true, startDate: true, endDate: true, days: true, status: true, reason: true, rejectedReason: true, createdAt: true,
        user: { select: { name: true } }, approvalSteps: stepSel },
      orderBy: { createdAt: "desc" }, take: 300,
    });
    for (const r of rows) items.push({
      kind: "LEAVE", id: r.id, title: `${leaveLabel(r.type)} ${r.days}일`, period: range(r.startDate, r.endDate), requester: r.user.name,
      status: normStatus(r.status), createdAt: r.createdAt.toISOString(), progress: progressOf(r.approvalSteps), lastComment: lastCommentOf(r.approvalSteps),
      rejectReason: r.rejectedReason ?? null,
      myDecision: who === "decided" ? (r.approvalSteps.find((s) => s.approverId === userId && (s.status === "APPROVED" || s.status === "REJECTED"))?.status as "APPROVED" | "REJECTED" | undefined) : undefined,
    });
  }
  if (want("LEAVE_CANCEL")) {
    const rows = await prisma.leaveCancelRequest.findMany({
      where: { ...(who === "mine" ? mineWhere : { approvalSteps: decidedStep }), ...(created ? { createdAt: created } : {}) },
      select: { id: true, status: true, reason: true, rejectedReason: true, createdAt: true, user: { select: { name: true } },
        leaveRequest: { select: { type: true, startDate: true, endDate: true } }, approvalSteps: stepSel },
      orderBy: { createdAt: "desc" }, take: 300,
    });
    for (const r of rows) items.push({
      kind: "LEAVE_CANCEL", id: r.id, title: `휴가 취소 — ${leaveLabel(r.leaveRequest.type)}`, period: range(r.leaveRequest.startDate, r.leaveRequest.endDate),
      requester: r.user.name, status: normStatus(r.status), createdAt: r.createdAt.toISOString(), progress: progressOf(r.approvalSteps),
      lastComment: lastCommentOf(r.approvalSteps), rejectReason: r.rejectedReason ?? null,
      myDecision: who === "decided" ? (r.approvalSteps.find((s) => s.approverId === userId && (s.status === "APPROVED" || s.status === "REJECTED"))?.status as "APPROVED" | "REJECTED" | undefined) : undefined,
    });
  }
  if (want("SCHEDULE")) {
    const rows = await prisma.scheduleRequest.findMany({
      where: { ...(who === "mine" ? mineWhere : { approvalSteps: decidedStep }), ...(created ? { createdAt: created } : {}) },
      select: { id: true, kind: true, templateName: true, startDate: true, endDate: true, status: true, reason: true, createdAt: true,
        user: { select: { name: true } }, approvalSteps: stepSel },
      orderBy: { createdAt: "desc" }, take: 300,
    });
    for (const r of rows) {
      const rej = [...r.approvalSteps].reverse().find((s) => s.status === "REJECTED");
      items.push({
        kind: "SCHEDULE", id: r.id, title: `${SCHED_KIND[r.kind] ?? "근무일정 신청"}${r.templateName ? ` · ${r.templateName}` : ""}`, period: range(r.startDate, r.endDate),
        requester: r.user.name, status: normStatus(String(r.status)), createdAt: r.createdAt.toISOString(), progress: progressOf(r.approvalSteps),
        lastComment: lastCommentOf(r.approvalSteps), rejectReason: rej?.comment ?? null,
        myDecision: who === "decided" ? (r.approvalSteps.find((s) => s.approverId === userId && (s.status === "APPROVED" || s.status === "REJECTED"))?.status as "APPROVED" | "REJECTED" | undefined) : undefined,
      });
    }
  }
  if (want("ATTENDANCE")) {
    const rows = await prisma.attendanceRequest.findMany({
      where: { ...(who === "mine" ? mineWhere : { decidedBy: userId, status: { in: ["APPROVED", "REJECTED"] } }), ...(created ? { createdAt: created } : {}) },
      select: { id: true, kind: true, action: true, workDate: true, status: true, reason: true, rejectReason: true, decidedBy: true, createdAt: true, user: { select: { name: true } } },
      orderBy: { createdAt: "desc" }, take: 300,
    });
    const deciders = new Map((await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.decidedBy).filter((x): x is string => !!x))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    for (const r of rows) items.push({
      kind: "ATTENDANCE", id: r.id,
      title: `${(ATT_KIND_LABEL as Record<string, string>)[r.kind] ?? "출퇴근 요청"}${r.action === "IN" ? " · 출근" : r.action === "OUT" ? " · 퇴근" : ""}`,
      period: utcYmd(r.workDate), requester: r.user.name, status: normStatus(r.status), createdAt: r.createdAt.toISOString(),
      progress: { done: r.status === "APPROVED" ? 1 : 0, total: 1 },
      lastComment: r.decidedBy && r.status === "REJECTED" && r.rejectReason ? { by: deciders.get(r.decidedBy) ?? "결재자", text: r.rejectReason } : null,
      rejectReason: r.rejectReason ?? null,
      myDecision: who === "decided" ? (r.status as "APPROVED" | "REJECTED") : undefined,
    });
  }

  // 상태·검색(#76) — 제목·요청자·마지막 의견·반려 사유에서
  const st = q.status && ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].includes(q.status) ? q.status : null;
  const term = (q.q || "").trim();
  return items
    .filter((i) => !st || i.status === st)
    .filter((i) => !term || [i.title, i.requester, i.period, i.lastComment?.text ?? "", i.rejectReason ?? ""].some((v) => v.includes(term)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 500);
}

