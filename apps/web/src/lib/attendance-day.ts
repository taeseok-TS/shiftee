// 지난 하루의 출퇴근 판정 — 누락·결근 공용 기준 (2026-10-17 #219 검증 F2)
//
// 근로시간 리포트(lib/work-report.ts)와 출퇴근 통계(api/attendance/stats)가 이 함수 하나를 쓴다.
// 종전에는 통계가 따로 셌다(퇴근만 있는 날을 결근으로, 공휴일 일정·입사 전·휴직자도 결근으로 셀 수 있었다).
//
//  · PENDING = 그날 출근·퇴근 요청(지점 밖·사진·본부)이 결재 대기 — 판정을 미룬다(누락·결근으로 세지 않는다)
//  · MISSING = 출근·퇴근 중 한쪽만 기록됨(「누락」)
//  · OK      = 출근·퇴근 모두 기록됨
//  · ABSENT  = 기록이 하나도 없는데 근무일정(WORK)이 있고, 휴가가 아니고, 공휴일이 아니고,
//              휴직(ON_LEAVE)·임시휴무(TEMPORARY)가 아니고, 입사일 이후·퇴사일 이전(당일 포함)인 날(「결근」)
//  · NONE    = 기록도 없고 결근도 아님(일정 없음·휴가·공휴일 등)
// 부르는 쪽이 「지난 날」(오늘 이전)만 넘긴다.

export type PastDayFacts = {
  ymd: string;                                   // "YYYY-MM-DD"(KST 근무일)
  pending: boolean;                              // 출근·퇴근 요청 결재 대기
  att?: { in: boolean; out: boolean } | null;    // 그날 기록(없으면 undefined/null)
  scheduled: boolean;                            // 근무일정(WORK) 있음
  onLeave: boolean;                              // 승인 휴가(반차 포함) 있음
  holiday: boolean;                              // 공휴일(Holiday 테이블)
  employmentStatus?: string | null;
  hireYmd?: string | null;
  resignYmd?: string | null;
};

export type PastDayStatus = "PENDING" | "MISSING" | "OK" | "ABSENT" | "NONE";

export function pastDayStatus(f: PastDayFacts): PastDayStatus {
  if (f.pending) return "PENDING";
  const a = f.att;
  if (a && a.in !== a.out) return "MISSING";
  if (a && a.in && a.out) return "OK";
  if (f.scheduled && !f.onLeave && !f.holiday
    && f.employmentStatus !== "ON_LEAVE" && f.employmentStatus !== "TEMPORARY"
    && (!f.hireYmd || f.ymd >= f.hireYmd) && (!f.resignYmd || f.ymd <= f.resignYmd)) return "ABSENT";
  return "NONE";
}
