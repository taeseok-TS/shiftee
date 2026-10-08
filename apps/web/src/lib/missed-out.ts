// 전날 퇴근 누락 → 「22:00 퇴근 동의」 자격(2026-10-08 개선 제안 #215-4, 76a0c00 검증 F1·F5)
//
// 동의는 결재 없이 바로 기록되므로 **상한 규칙을 우회하면 안 된다**:
//  · 평일: 22:00 − 출근 이 10.5시간(WEEKDAY_CAP — 앱 퇴근 차단·관리자 마감과 같은 상수)을 넘으면 불가 → 「퇴근 처리 요청」(결재)
//  · 주말·공휴일: 승인된 근무시간이 기준이라 고정 22:00 은 성립하지 않음 → 불가
//  · 출근이 22:00 이후면 불가
//  · 그 날 퇴근 쪽 요청(퇴근 누락·기록 수정·지점 밖/사진/본부 퇴근)이 대기 중이면 불가 — 두 갈래로 처리되지 않게
import { prisma } from "@/lib/db";
import { isHoliday } from "@/lib/holidays";
import { WEEKDAY_CAP_MS, WEEKDAY_CAP_HOURS } from "@/lib/attendance-policy";

export const CLOSE_HOUR_KST = 22;

export function clockOut22Of(ymd: string): Date {
  return new Date(`${ymd}T${String(CLOSE_HOUR_KST).padStart(2, "0")}:00:00+09:00`);
}

export type Consent22Check = { ok: boolean; reason?: string };   // ok=false 면 reason 에 사유

export async function consent22Eligibility(clockIn: Date, ymd: string): Promise<Consent22Check> {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();   // ymd 는 KST 날짜 — UTC 자정으로 만들면 요일이 그대로
  if (day === 0 || day === 6 || (await isHoliday(ymd)))
    return { ok: false, reason: "주말·공휴일 근무는 승인된 근무시간으로 처리합니다. 「퇴근 처리 요청하기」로 실제 시각을 넣어 주세요." };
  const out = clockOut22Of(ymd);
  if (clockIn >= out)
    return { ok: false, reason: "출근이 22시 이후여서 22:00 퇴근으로 처리할 수 없습니다. 「퇴근 처리 요청하기」로 실제 시각을 넣어 주세요." };
  if (out.getTime() - clockIn.getTime() > WEEKDAY_CAP_MS)
    return { ok: false, reason: `22:00 퇴근이면 근무가 ${WEEKDAY_CAP_HOURS}시간을 넘어 관리자 확인이 필요합니다. 「퇴근 처리 요청하기」로 넣어 주세요.` };
  return { ok: true };
}

/** 그 날 퇴근 쪽 요청이 대기 중인가(퇴근 누락·기록 수정·지점 밖/사진/본부 퇴근) */
export async function hasPendingOutRequest(userId: string, workDate: Date): Promise<boolean> {
  const pending = await prisma.attendanceRequest.findFirst({
    where: { userId, workDate, status: "PENDING", OR: [{ kind: { in: ["MISSED_OUT", "CORRECTION"] } }, { action: "OUT" }] },
    select: { id: true },
  });
  return !!pending;
}
