import {
  fiscalYearAccrued, fiscalEvents, hireBasisEvents, resignSettlement, activeSettlementDays,
  usedDaysFromHours, accrualBasisText, roundTo, type AccrualEvent,
} from "@/lib/leave-accrual";

// 연차 정산(2026-10-16 이예지 QA76 #57 #58 #59 #60) — 한 사람 몫 계산. 순수 함수만(DB 없음) — 서버(api/leave/settlement)·화면·시험이 같이 쓴다.
// 계산식은 lib/leave-accrual.ts 그대로 쓴다(포털 「퇴사자 연차수당 계산」과 같음, 올림 없음, 소수 둘째 자리). 여기서는 묶어서 행 모양만 만든다.
//  - 재직자(#57 #59 미사용 연차): 그해 회계 기준 발생(기준일까지) − 그해 사용 = 정산 일수. 미사용분은 수당으로 주므로 촉진·소멸 없음
//  - 퇴사자(#60, 퇴사 때는 입사일 기준): 입사일 기준 총 발생 − 회계 기준 전년도까지 누적 − 당해 사용 = 정산 일수
//  - 사용 일수 = 휴가 시간 ÷ 8(소수 둘째 자리) — 호출부가 승인된 연차 차감 휴가의 시간 합을 넘긴다(일수 × 8)
//  - 금액은 계산하지 않는다(일수까지만). 음수(초과 사용)는 그대로 두고 negative 로 알린다

export type SettleEvent = AccrualEvent & { future?: boolean };

export type ActiveCalc = {
  accrued: number;          // 그해 회계 기준 발생(기준일까지)
  yearEnd: number;          // 연말(퇴사일이 그해면 퇴사일)까지 발생 예정
  used: number;             // 그해 사용(일)
  settlement: number;       // 정산(미사용) 일수 = accrued − used
  negative: boolean;        // 초과 사용
  basis: string;            // 산정 근거 한 줄(accrualBasisText)
  events: SettleEvent[];    // 그해 발생 이벤트 — 기준일 뒤 것은 future(예정)
};

export function activeCalc(hire: string, year: number, asOf: string, usedHours: number, resign?: string | null): ActiveCalc {
  const used = usedDaysFromHours(usedHours);
  const now = fiscalYearAccrued(hire, year, asOf);
  const endCap = resign && resign < `${year}-12-31` ? resign : `${year}-12-31`;
  const end = fiscalYearAccrued(hire, year, endCap);
  const settlement = activeSettlementDays(hire, year, used, asOf);
  return {
    accrued: now.days,
    yearEnd: end.days,
    used,
    settlement,
    negative: settlement < 0,
    // 기준일을 「오늘」로 넘긴다 — accrualAsOf(year, asOf) = asOf(같은 해). 퇴사일이 그해면 「(퇴사일 …까지)」가 붙는다
    basis: accrualBasisText(hire, year, asOf, resign ?? null),
    events: end.events.map((e) => (e.date > asOf ? { ...e, future: true } : e)),
  };
}

export type ResignedCalc = {
  hireBasis: number;          // 입사일 기준 총 발생(퇴사일까지)
  fiscalBeforeYear: number;   // 회계 기준 전년도(퇴사 연도 − 1)까지 누적 발생
  used: number;               // 퇴사 연도 사용(일)
  settlement: number;         // 정산 일수
  negative: boolean;
  basis: string;              // 산정 근거 문자열(엑셀·화면)
  hireEvents: AccrualEvent[];     // 입사일 기준 발생 내역(펼침용)
  fiscalEvents: AccrualEvent[];   // 회계 기준 전년도까지 발생 내역(펼침용)
};

const n2 = (v: number) => String(roundTo(v, 2));

export function resignedCalc(hire: string, resign: string, usedHours: number): ResignedCalc {
  const used = usedDaysFromHours(usedHours);
  const r = resignSettlement(hire, resign, used);
  const y = Number(resign.slice(0, 4));
  const hireEvents = hireBasisEvents(hire, resign);
  const fEvents = fiscalEvents(hire, `${y - 1}-12-31`);
  const monthly = hireEvents.filter((e) => e.kind === "월차").length;
  const annual = hireEvents.filter((e) => e.kind !== "월차").map((e) => `${e.note} ${e.days}`);
  const hireText = [monthly ? `월차 ${monthly}` : "", ...annual].filter(Boolean).join(" + ") || "발생 없음";
  const basis = `입사일 기준 ${n2(r.hireBasis)}일(${hireText}) − 회계 기준 ${y - 1}년까지 ${n2(r.fiscalBeforeYear)}일 − ${y}년 사용 ${n2(used)}일 = ${n2(r.days)}일`;
  return {
    hireBasis: r.hireBasis, fiscalBeforeYear: r.fiscalBeforeYear, used, settlement: r.days, negative: r.days < 0,
    basis, hireEvents, fiscalEvents: fEvents,
  };
}

// ─── API 응답 모양(화면·엑셀이 같이 쓴다) ───
export type GrantLeft = { compHours: number; substHours: number };   // 보상휴가·대체휴일 남은 시간(일 × 8, 음수 가능)

type RowBase = {
  userId: string; empNo: number | null; name: string; branch: string | null; position: string | null; role: string;
  hireDate: string | null;      // 없으면 계산 안 함(「입사일 없음」)
  balanceUsed: number | null;   // 그해 연차 행의 「사용」(대조용 — 승인 휴가 합(자르는 날 뒤 몫 포함)과 다르면 화면에 표시)
  crossYear: boolean;           // 정산 연도와 다른 해에 걸친 승인 휴가가 있음(시작일 연도에 통째로 넣었다 — 확인)
} & GrantLeft;

// usedAfterAsOf = 기준일 뒤에 시작하는 그해 승인 휴가(참고 — 정산에 넣지 않음) · crossAsOf = 기준일을 걸친 휴가(통째로 사용에 넣었다 — 확인)
export type ActiveRow = RowBase & { resignDate: string | null; usedAfterAsOf: number; crossAsOf: boolean; calc: ActiveCalc | null };
// usedAfterResign = 퇴사일 뒤에 시작하는 승인 휴가 전부(다음 해 포함, 정산에 넣지 않음 — 취소 필요), usedAfterResignInYear = 그중 퇴사 연도 몫(잔여 행 대조용) · crossResign = 퇴사일을 걸친 휴가(통째로 사용에 넣었다 — 확인)
export type ResignedRow = RowBase & { resignDate: string; usedAfterResign: number; usedAfterResignInYear: number; crossResign: boolean; calc: ResignedCalc | null };

export type SettlementResponse =
  | { mode: "active"; year: number; asOf: string; rows: ActiveRow[] }
  | { mode: "resigned"; from: string; to: string; rows: ResignedRow[] };
