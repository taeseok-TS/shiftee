import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { personLabel } from "@/lib/person-label";
import { KIND_LABEL, type RequestKind } from "@/lib/attendance-request";

// ─── 출퇴근 기록 수정 이력(2026-10-16 이예지 QA #219-15) ─────────────────────────
// 근로감독 때 「원래 찍힌 시각」과 「고친 이유」, 「누가 고치고 누가 승인했는지」를 바로 보여 주려고 남긴다.
// 기록을 바꾸는 경로마다 **같은 트랜잭션 안에서** recordAttendanceEdit 를 부른다(이력 없이 기록만 바뀌는 일이 없게).
//  · 관리자 수정 PATCH /api/attendance/[id]              → ADMIN_EDIT (사유 = 관리자가 적은 사유)
//  · 관리자 기록 추가 POST /api/attendance                 → ADMIN_CREATE (원래 기록 없음)
//  · (옛) 누락 자동 보정 auto-fill → AUTO_FILL — 10/22 본부 요청으로 없앰, 지금은 보정 창에서 사람이 넣는다(ADMIN_EDIT)
//  · 전일 미마감 마감 POST /api/admin/attendance/unclosed  → AUTO_CLOSE
//  · 퇴근 누락 본인 동의 POST /api/attendance-requests/missed-out/consent → SELF_CONSENT
//  · 출퇴근 요청 승인 POST /api/attendance-requests/[id]    → REQUEST_<종류> (사유 = 직원이 쓴 사유, 승인자 따로)
// 직원 본인의 정상 출근·퇴근 찍기(clock-in/clock-out)는 수정이 아니라 남기지 않는다.
// 표는 덧붙이기만 한다 — 칸마다 **처음 바뀐 줄의 before** 가 「원래 찍힌 시각」이라 여러 번 고쳐도 처음 값이 남는다.

export const EDIT_KIND_LABEL: Record<string, string> = {
  ADMIN_EDIT: "관리자 수정",
  ADMIN_CREATE: "관리자 기록 추가",
  AUTO_FILL: "누락 자동 보정",
  AUTO_CLOSE: "전일 미마감 마감",
  SELF_CONSENT: "퇴근 누락 본인 동의",
};

/** 화면·엑셀에 보일 수정 종류 — 요청 승인은 「출퇴근기록 수정 요청 승인」처럼 */
export function editKindLabel(kind: string): string {
  if (kind.startsWith("REQUEST_")) {
    const k = kind.slice("REQUEST_".length) as RequestKind;
    return `${KIND_LABEL[k] ?? k} 요청 승인`;
  }
  return EDIT_KIND_LABEL[kind] ?? kind;
}

type Snap = { clockIn: Date | null; clockOut: Date | null; status?: string | null };
type Db = Pick<typeof prisma, "attendanceEdit">;

/**
 * 수정 이력 한 줄을 남긴다. 호출부의 트랜잭션(tx)으로 부른다 — 표가 없거나 쓰기가 실패하면 수정째 되돌아간다.
 * 출근·퇴근 시각이 하나도 안 바뀌었으면 남기지 않는다.
 */
export async function recordAttendanceEdit(db: Db, e: {
  attendanceId: string; userId: string; workDate: Date; kind: string;
  before: Snap | null; after: Snap;
  reason?: string | null; requestId?: string | null;
  editorId?: string | null; editorName: string; approverName?: string | null;
}): Promise<void> {
  const b = e.before;
  const same = (x: Date | null | undefined, y: Date | null | undefined) => +(x ?? 0) === +(y ?? 0);
  // 출근·퇴근 시각이 그대로면 남기지 않는다 — 지각·조퇴 상태만 다시 계산된 것은 「수정」이 아니다(검증 6)
  if (b && same(b.clockIn, e.after.clockIn) && same(b.clockOut, e.after.clockOut)) return;
  await db.attendanceEdit.create({
    data: {
      attendanceId: e.attendanceId, userId: e.userId, workDate: e.workDate, kind: e.kind,
      beforeIn: b?.clockIn ?? null, beforeOut: b?.clockOut ?? null, beforeStatus: b?.status ?? null,
      afterIn: e.after.clockIn, afterOut: e.after.clockOut, afterStatus: e.after.status ?? null,
      reason: e.reason?.trim() ? e.reason.trim().slice(0, 300) : null,
      requestId: e.requestId ?? null,
      editorId: e.editorId ?? null,
      editorName: e.editorName || "알 수 없음",
      approverName: e.approverName ?? null,
    },
  });
}

/** 그 시점 「이름 직급」 — 토큰 이름보다 DB 의 현재 이름을 쓴다(감사 로그와 같은 규칙). 못 찾으면 넘어온 이름 */
export async function personLabelOf(userId: string, fallback: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { name: true, position: true } }).catch(() => null);
  return personLabel(u) || fallback;
}

// ─── 목록·엑셀용 요약 ─────────────────────────────────────────────────────────

/** 출퇴근 한 건의 수정 요약 — 서버가 글로 만들어 내려준다(화면은 그대로 보이기만) */
export type AttendanceEditView = {
  count: number;
  inChanged: boolean;
  outChanged: boolean;
  /** 원래 출근·퇴근 — 바뀐 칸만. 「09:12」, 날짜가 다르면 「10/17 01:10」, 원래 비어 있었으면 「기록 없음」 */
  origIn: string | null;
  origOut: string | null;
  /** 수정 사유(사유가 없는 경로는 수정 종류). 여러 번이면 「 / 」로 잇는다 */
  reason: string;
  /** 수정·승인자 — 「김태석 본부장」, 요청 승인이면 「이예지 대리 요청 · 김태석 본부장 승인」 */
  by: string;
  /** 이력 한 줄씩(오래된 순) — 마우스 올림·펼침에 보인다 */
  lines: string[];
};

const KST = 9 * 3600_000;
function hhmm(t: Date | null, workYmd: string): string {
  if (!t) return "기록 없음";
  const k = new Date(t.getTime() + KST).toISOString();
  return k.slice(0, 10) === workYmd ? k.slice(11, 16) : `${k.slice(5, 7)}/${k.slice(8, 10)} ${k.slice(11, 16)}`;
}
const short = (t: Date | null, workYmd: string) => (t ? hhmm(t, workYmd) : "-");

type EditRow = {
  attendanceId: string; workDate: Date; kind: string; createdAt: Date;
  beforeIn: Date | null; beforeOut: Date | null; afterIn: Date | null; afterOut: Date | null;
  reason: string | null; editorName: string; approverName: string | null;
};

/** 수정 이력을 출퇴근 id 별 요약으로. where 로 범위를 준다(예: { attendance: { userId, date: { gte, lte } } }) */
export async function attendanceEditViews(where: Prisma.AttendanceEditWhereInput): Promise<Map<string, AttendanceEditView>> {
  const rows: EditRow[] = await prisma.attendanceEdit.findMany({
    where,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      attendanceId: true, workDate: true, kind: true, createdAt: true,
      beforeIn: true, beforeOut: true, afterIn: true, afterOut: true,
      reason: true, editorName: true, approverName: true,
    },
  });
  const byAtt = new Map<string, EditRow[]>();
  for (const r of rows) {
    const list = byAtt.get(r.attendanceId);
    if (list) list.push(r); else byAtt.set(r.attendanceId, [r]);
  }
  const out = new Map<string, AttendanceEditView>();
  for (const [id, list] of byAtt) out.set(id, summarize(list));
  return out;
}

function summarize(list: EditRow[]): AttendanceEditView {
  const workYmd = list[0].workDate.toISOString().slice(0, 10);
  const same = (x: Date | null, y: Date | null) => +(x ?? 0) === +(y ?? 0);
  // 칸마다 처음 바뀐 줄의 before = 원래 찍힌 시각
  const firstIn = list.find((r) => !same(r.beforeIn, r.afterIn));
  const firstOut = list.find((r) => !same(r.beforeOut, r.afterOut));
  const reasons: string[] = [];
  const bys: string[] = [];
  const lines: string[] = [];
  for (const r of list) {
    const label = editKindLabel(r.kind);
    const reason = r.reason || label;
    if (!reasons.includes(reason)) reasons.push(reason);
    const by = r.approverName ? `${r.editorName} 요청 · ${r.approverName} 승인` : r.editorName;
    if (!bys.includes(by)) bys.push(by);
    const parts: string[] = [];
    if (!same(r.beforeIn, r.afterIn)) parts.push(`출근 ${short(r.beforeIn, workYmd)}→${short(r.afterIn, workYmd)}`);
    if (!same(r.beforeOut, r.afterOut)) parts.push(`퇴근 ${short(r.beforeOut, workYmd)}→${short(r.afterOut, workYmd)}`);
    const at = new Date(r.createdAt.getTime() + KST).toISOString();
    lines.push([
      `${at.slice(5, 7)}/${at.slice(8, 10)} ${at.slice(11, 16)} ${label}`,
      parts.join(", ") || "상태만 다시 계산",
      r.reason ? `사유: ${r.reason}` : "",
      by,
    ].filter(Boolean).join(" · "));
  }
  return {
    count: list.length,
    inChanged: !!firstIn,
    outChanged: !!firstOut,
    origIn: firstIn ? hhmm(firstIn.beforeIn, workYmd) : null,
    origOut: firstOut ? hhmm(firstOut.beforeOut, workYmd) : null,
    reason: reasons.join(" / "),
    by: bys.join(" / "),
    lines,
  };
}
