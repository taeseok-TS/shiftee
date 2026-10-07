import { prisma } from "@/lib/db";
import { isHoliday } from "@/lib/holidays";
import { calcStatus } from "@/lib/attendance-status";
import { approverScopeFor, isMyStep, branchHasApprover, type ApproverScope } from "@/lib/approval-delegate";

// ─── 출퇴근 요청(2026-10-07 QA #9 #13 #15, 본부 답변 #5 #6 #10 #11) ─────────────
// 종류
//  · OUTSIDE    지점 밖 출퇴근(본사·서점·외근 등) — 원장 승인(원장 본인은 본부)
//  · PHOTO      위치 인증이 3번 실패해 지점 사진으로 출퇴근 — 원장 승인(원장 본인은 본부)
//  · HQ         위치 인증 실패 후 본부에 출퇴근 처리 요청 — 본부 승인
//  · CORRECTION 출퇴근기록 수정(지각·누락) — 원장 승인(#5), 원장 본인은 본부
//  · MISSED_OUT 전날 퇴근 누락 → 퇴근 시각 넣어 요청 — 원장 승인, 원장 본인은 본부
//  · DEVICE     기기 변경(로그인 화면 「미등록 기기」에서 접수) — 본부 승인(#6)
// 결재는 한 단계. 원장 단계 판정은 휴가·근무일정과 같은 함수(isMyStep — 원장대행 포함, 대행자는 원장 건 제외).
// 승인되면 **누른 시각**으로 기록하고 지각도 그 시각으로 판정한다(#10). 반려하면 기록하지 않는다.

export const REQUEST_KINDS = ["OUTSIDE", "PHOTO", "HQ", "CORRECTION", "MISSED_OUT", "DEVICE"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const KIND_LABEL: Record<RequestKind, string> = {
  OUTSIDE: "지점 밖 출퇴근",
  PHOTO: "사진 출퇴근",
  HQ: "본부 출퇴근 처리",
  CORRECTION: "출퇴근기록 수정",
  MISSED_OUT: "퇴근 누락",
  DEVICE: "기기 변경",
};

/** 지점 밖 출퇴근 사유 — 이 셋 말고는 「기타」로 직접 입력(50자) */
export const OUTSIDE_REASONS = ["본사 방문", "서점(교재 구입)", "외근"] as const;

export const KST_MS = 9 * 3600_000;

/** KST 날짜(YYYY-MM-DD)의 @db.Date 값(UTC 자정) */
export function dateOfYmd(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
/** @db.Date 값 → YYYY-MM-DD */
export function ymdOfDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** 실제 시각 → KST 날짜 */
export function kstYmdOf(t: Date): string {
  return new Date(t.getTime() + KST_MS).toISOString().slice(0, 10);
}
/** KST 날짜 + "HH:mm" → 실제 시각. 형식이 틀리면 null */
export function kstDateTime(ymd: string, hhmm: string): Date | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - KST_MS);
}
/** 실제 시각 → KST "HH:mm" */
export function kstHHmm(t: Date): string {
  return new Date(t.getTime() + KST_MS).toISOString().slice(11, 16);
}

/** 결재자 — 본부 처리·기기 변경은 본부, 나머지는 신청자 지점 원장(원장 본인·원장 없는 지점은 본부) */
export async function resolveApprover(user: { role: string; branch: string | null }, kind: RequestKind) {
  if (kind === "HQ" || kind === "DEVICE") return { approverRole: "ADMIN", branch: user.branch };
  if (user.role === "MANAGER" || user.role === "ADMIN" || !user.branch) return { approverRole: "ADMIN", branch: user.branch };
  return (await branchHasApprover(user.branch))
    ? { approverRole: "MANAGER", branch: user.branch }
    : { approverRole: "ADMIN", branch: user.branch };
}

type ReqLike = { status: string; approverRole: string; branch: string | null; userId: string };

/** 이 요청을 지금 내가 처리할 수 있나 — 관리자는 전부, 그 외는 isMyStep(원장대행 포함). 본인 요청은 불가 */
export function canDecide(
  r: ReqLike,
  session: { userId: string; role: string },
  scope: ApproverScope,
  requesterRole: string | null | undefined,
): boolean {
  if (r.status !== "PENDING") return false;
  if (session.role === "ADMIN") return true;
  if (r.userId === session.userId) return false;
  return isMyStep({ status: r.status, approverRole: r.approverRole, branch: r.branch, approverId: null }, session, scope, requesterRole);
}

/** 결재함 조건 — canDecide 와 같은 규칙(관리자는 대기 전부) */
export async function inboxWhere(session: { userId: string; role: string }) {
  if (session.role === "ADMIN") return { status: "PENDING" };
  const scope = await approverScopeFor(session);
  const or = [
    ...(scope.own.length ? [{ approverRole: "MANAGER", branch: { in: scope.own } }] : []),
    ...(scope.delegated.length
      ? [{ approverRole: "MANAGER", branch: { in: scope.delegated }, user: { role: { not: "MANAGER" as const } } }]
      : []),
  ];
  if (or.length === 0) return null;   // 결재할 지점이 없다
  return { status: "PENDING", userId: { not: session.userId }, OR: or };
}

/** 장소 칸에 남길 글 — 「지점 밖 · 본사 방문 (원장 승인)」 */
export function placeLabel(kind: RequestKind, reason: string | null, deciderRole: string): string {
  const who = deciderRole === "ADMIN" ? "본부 승인" : "원장 승인";
  if (kind === "OUTSIDE") return `지점 밖 · ${reason || "사유 없음"} (${who})`;
  if (kind === "PHOTO") return `사진 확인 (${who})`;
  if (kind === "HQ") return "본부 처리";
  return `기록 수정 (${who})`;
}

export class RequestConflict extends Error {}

type FullReq = {
  id: string; userId: string; kind: string; action: string | null; workDate: Date; requestedAt: Date;
  clockIn: Date | null; clockOut: Date | null; reason: string | null; latitude: number | null; longitude: number | null;
  deviceId: string | null; deviceName: string | null; platform: string | null;
};

/**
 * 승인된 요청을 기록에 반영한다. 호출부가 트랜잭션(tx) 안에서 부른다 — 충돌하면 RequestConflict 를 던져 승인째 되돌린다.
 * 반환: 기기 변경이면 { deviceChanged: true }(호출부가 세션을 끊는다)
 */
export async function applyApproved(
  tx: Pick<typeof prisma, "attendance" | "userDevice">,
  r: FullReq,
  deciderRole: string,
): Promise<{ deviceChanged?: boolean }> {
  const kind = r.kind as RequestKind;
  const ymd = ymdOfDate(r.workDate);

  if (kind === "DEVICE") {
    if (!r.deviceId) throw new RequestConflict("기기 정보가 없는 요청입니다.");
    await tx.userDevice.upsert({
      where: { userId: r.userId },
      create: { userId: r.userId, deviceId: r.deviceId, deviceName: r.deviceName, platform: r.platform },
      update: { deviceId: r.deviceId, deviceName: r.deviceName, platform: r.platform, createdAt: new Date() },
    });
    return { deviceChanged: true };
  }

  const existing = await tx.attendance.findUnique({ where: { userId_date: { userId: r.userId, date: r.workDate } } });
  const place = placeLabel(kind, r.reason, deciderRole);

  if (kind === "OUTSIDE" || kind === "PHOTO" || kind === "HQ") {
    if (r.action === "IN") {
      if (existing?.clockIn) throw new RequestConflict("이미 출근 기록이 있습니다.");
      const status = await calcStatus(r.requestedAt, existing?.clockOut ?? null, ymd, r.userId);
      const data = { clockIn: r.requestedAt, clockInPlace: place, latitude: r.latitude, longitude: r.longitude, status };
      if (existing) await tx.attendance.update({ where: { id: existing.id }, data });
      else await tx.attendance.create({ data: { userId: r.userId, date: r.workDate, ...data } });
      return {};
    }
    if (existing?.clockOut) throw new RequestConflict("이미 퇴근 기록이 있습니다.");
    const status = await calcStatus(existing?.clockIn ?? null, r.requestedAt, ymd, r.userId);
    const data = { clockOut: r.requestedAt, clockOutPlace: place, clockOutLat: r.latitude, clockOutLng: r.longitude, status };
    if (existing) await tx.attendance.update({ where: { id: existing.id }, data });
    else await tx.attendance.create({ data: { userId: r.userId, date: r.workDate, ...data } });
    return {};
  }

  if (kind === "MISSED_OUT") {
    if (!existing?.clockIn) throw new RequestConflict("그날 출근 기록이 없습니다.");
    if (existing.clockOut) throw new RequestConflict("이미 퇴근 기록이 있습니다.");
    if (!r.clockOut) throw new RequestConflict("퇴근 시각이 없는 요청입니다.");
    const status = await calcStatus(existing.clockIn, r.clockOut, ymd, r.userId);
    await tx.attendance.update({ where: { id: existing.id }, data: { clockOut: r.clockOut, clockOutPlace: place, status } });
    return {};
  }

  // CORRECTION — 넣은 칸만 바꾼다
  const clockIn = r.clockIn ?? existing?.clockIn ?? null;
  const clockOut = r.clockOut ?? existing?.clockOut ?? null;
  if (clockIn && clockOut && clockOut <= clockIn) throw new RequestConflict("퇴근 시각이 출근 시각보다 빠릅니다.");
  const status = await calcStatus(clockIn, clockOut, ymd, r.userId);
  const data = {
    ...(r.clockIn ? { clockIn: r.clockIn, clockInPlace: place } : {}),
    ...(r.clockOut ? { clockOut: r.clockOut, clockOutPlace: place } : {}),
    status,
  };
  if (existing) await tx.attendance.update({ where: { id: existing.id }, data });
  else await tx.attendance.create({ data: { userId: r.userId, date: r.workDate, ...data } });
  return {};
}

/** 주말·공휴일 출근은 승인된 근무일정이 있어야 한다(출근 버튼과 같은 규칙) — 막히면 이유 문구 */
export async function weekendClockInBlock(userId: string, ymd: string): Promise<string | null> {
  const day = dateOfYmd(ymd).getUTCDay();
  const holiday = await isHoliday(ymd);
  if (day !== 0 && day !== 6 && !holiday) return null;
  const sched = await prisma.schedule.findFirst({ where: { userId, date: dateOfYmd(ymd), type: "WORK" }, select: { id: true } });
  if (sched) return null;
  const kind = day === 0 || day === 6 ? "주말" : "공휴일";
  return `${kind} 근무는 사전에 근무일정을 신청하고 승인받은 후에만 출근할 수 있습니다.`;
}

/** 요청 한 줄 요약(알림·목록) — 「지점 밖 출근 10/14 09:49 · 본사 방문」 */
export function summaryOf(r: { kind: string; action: string | null; workDate: Date; requestedAt: Date; clockIn: Date | null; clockOut: Date | null; reason: string | null }): string {
  const kind = r.kind as RequestKind;
  const md = ymdOfDate(r.workDate).slice(5).replace("-", "/");
  if (kind === "OUTSIDE" || kind === "PHOTO" || kind === "HQ") {
    const head = kind === "OUTSIDE" ? "지점 밖" : kind === "PHOTO" ? "사진" : "본부 처리";
    return `${head} ${r.action === "OUT" ? "퇴근" : "출근"} ${md} ${kstHHmm(r.requestedAt)}${r.reason ? ` · ${r.reason}` : ""}`;
  }
  if (kind === "MISSED_OUT") return `퇴근 누락 ${md} · 퇴근 ${r.clockOut ? kstHHmm(r.clockOut) : "-"}`;
  if (kind === "CORRECTION") {
    const parts = [r.clockIn ? `출근 ${kstHHmm(r.clockIn)}` : "", r.clockOut ? `퇴근 ${kstHHmm(r.clockOut)}` : ""].filter(Boolean);
    return `기록 수정 ${md} · ${parts.join(" / ")}`;
  }
  return "기기 변경";
}
