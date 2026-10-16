// 전날 퇴근 누락 → 「근무일정 퇴근 시각으로 처리 동의」 자격(2026-10-08 개선 제안 #215-4 · 76a0c00 검증 F1·F5)
//
// 2026-10-17 디렉터 결정(#219-4 후속): 종전에는 22:00 고정이었다. 이제 관리자 자동 마감과 **같은 함수**
// (lib/attendance-policy autoCloseTime — 근무일정 퇴근 시각, 없으면 출근 + 보정 시간, 상한·퇴근 가능 시각·23:59 에서 자름)로
// 시각을 정하고, 앱은 서버가 준 그 시각을 그대로 보여 준다. 09:00~18:00 일정이면 18:00, 13:00~22:00 이면 22:00.
//
// 동의는 결재 없이 바로 기록되므로 **상한 규칙을 우회하면 안 된다**:
//  · 시스템이 잘라 넣어야 하는 시각(basis = CAP — 상한·퇴근 가능 시각에 걸림)이면 불가 → 「퇴근 처리 요청」(결재)
//  · 동의할 시각이 출근보다 늦지 않으면(0분) 불가
//  · 그 날 퇴근 쪽 요청(퇴근 누락·기록 수정·지점 밖/사진/본부 퇴근)이 대기 중이면 불가 — 두 갈래로 처리되지 않게
// (주말·공휴일도 근무일정이 있으면 그 퇴근 시각으로 처리할 수 있다 — 상한은 승인 근무시간 + 45분. 종전 22:00 고정은 불가였다)
import { prisma } from "@/lib/db";
import { autoCloseTime, type AutoFillResult } from "@/lib/attendance-policy";

/** "HH:mm"(KST) */
export function kstHhmm(d: Date): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(11, 16);
}

export type ConsentCheck = {
  ok: boolean;
  /** ok=false 면 사유 */
  reason?: string;
  /** 동의하면 기록될 퇴근 시각과 기준(자격이 없어도 계산값은 준다) */
  close: AutoFillResult;
};

/** 퇴근 누락 날의 「본인 동의」 자격과 기록될 시각 — 관리자 자동 마감과 같은 기준 */
export async function consentEligibility(userId: string, clockIn: Date, ymd: string): Promise<ConsentCheck> {
  const close = await autoCloseTime(userId, ymd, clockIn);
  if (close.at.getTime() <= clockIn.getTime())
    return { ok: false, close, reason: "출근 시각 뒤로 처리할 퇴근 시각이 없습니다. 「퇴근 처리 요청하기」로 실제 시각을 넣어 주세요." };
  if (close.basis === "CAP")
    return { ok: false, close, reason: "근무 시간 상한을 넘어 관리자 확인이 필요합니다. 「퇴근 처리 요청하기」로 실제 시각을 넣어 주세요." };
  return { ok: true, close };
}

/** 그 날 퇴근 쪽 요청이 대기 중인가(퇴근 누락·기록 수정·지점 밖/사진/본부 퇴근) */
export async function hasPendingOutRequest(userId: string, workDate: Date): Promise<boolean> {
  const pending = await prisma.attendanceRequest.findFirst({
    where: { userId, workDate, status: "PENDING", OR: [{ kind: { in: ["MISSED_OUT", "CORRECTION"] } }, { action: "OUT" }] },
    select: { id: true },
  });
  return !!pending;
}
