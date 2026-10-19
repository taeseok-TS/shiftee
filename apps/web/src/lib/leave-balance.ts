import type { Prisma } from "@prisma/client";
import { currentLeaveYear } from "@/lib/leave-calc";
import { kstDate, yearTotalAsOf } from "@/lib/leave-accrual";
import { leaveDaysByYear, approvedDaysByYear, byYearToJson, type LeaveSpan, type ApprovedSpan } from "@/lib/leave-days";

/**
 * 연차 **차감·복구는 여기 두 함수로만** 한다(2026-09-11). 종전에는 차감이 세 곳(휴가 신청 자동승인 ·
 * 단계 최종승인 · 관리자 직접처리)에 복붙돼 있어 한 곳만 고치면 어긋났다.
 *
 * 휴가 한 건은 `deductLeave` / `restoreLeave`(아래)로 차감·복구한다 — 휴가를 **날짜별로 해마다 나눠**(lib/leave-days
 * leaveDaysByYear) 그 해 행마다 두 함수를 부른다(2026-10-19 본부 이예지 답: 12/31~1/2 는 12/31 몫 그해, 1/2 몫 다음 해).
 * 한 해 안의 휴가는 종전(시작일 연도에 days)과 똑같다. 종전 9/11 「시작일 연도에 통째로」는 걸친 휴가만 바뀌었다.
 * 차감한 해마다 몫은 그 휴가(LeaveRequest.deductedByYear)에 같은 트랜잭션으로 저장하고, 복구는 **저장값**으로 한다
 * (없으면 옛 규칙 — 시작 해에 days, lib/leave-days approvedDaysByYear).
 *
 * ⚠ 그 해 행이 없으면 **연초 이월(api/leave/rollover)과 같은 계산**으로 만든다(근속, 그 해 1월 1일 기준).
 *   기본값 15 로 만들면 1월 이월이 "행 있음"으로 건너뛰어 근속 재부여가 빠진다. 이월 계산을 바꾸면 여기도.
 */
type Db = Prisma.TransactionClient;

/** 그 해 연차 행이 없을 때의 총연차 — 연도 전환과 같은 계산(회계연도 기준 그 시점까지 발생, 퇴사일까지, 2026-10-16 #31). 입사일 없으면 15 */
export async function defaultYearTotal(db: Db, userId: string, year: number): Promise<number> {
  return (await defaultYearRow(db, userId, year)).total;
}
/** 새 행 값 — total 과 자동 몫(accruedAuto, 입사일 없으면 null) */
async function defaultYearRow(db: Db, userId: string, year: number): Promise<{ total: number; accruedAuto: number | null }> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { hireDate: true, resignDate: true } });
  if (!u?.hireDate) return { total: 15, accruedAuto: null };
  const t = Math.max(0, yearTotalAsOf(kstDate(u.hireDate), year, undefined, u.resignDate ? kstDate(u.resignDate) : null));
  return { total: t, accruedAuto: t };
}

/** 연차 차감 — 그 해 행에서. 행이 없으면 이월과 같은 총연차로 만든 뒤 차감한다. */
export async function deductLeaveBalance(db: Db, userId: string, year: number, days: number): Promise<void> {
  const { total, accruedAuto } = await defaultYearRow(db, userId, year);   // 행이 있으면 쓰이지 않는다(upsert create 용)
  await db.leaveBalance.upsert({
    where: { userId_year: { userId, year } },
    create: { userId, year, total, accruedAuto, used: days, remaining: total - days },
    update: { used: { increment: days }, remaining: { decrement: days } },
  });
}

/** 한 해 복구 결과 — ok = 다 복구 · missing = 그 해 행 없음(복구 안 함) · clamped = 사용이 모자라 0 에서 멈춤 */
export type RestoreOutcome = { year: number; wanted: number; restored: number; status: "ok" | "missing" | "clamped" };

/**
 * 연차 복구 — 차감과 같은 해 행에. **사용(used)은 0 아래로 내리지 않는다**(2026-10-19 검증) — 손으로 사용을 줄였거나
 * 옛 데이터로 몫이 어긋났을 때 음수가 되지 않게, 남은 사용만큼만 복구하고 clamped 로 알린다(호출부가 감사 기록에 남긴다).
 * 행이 없으면 0(missing — 복구할 차감이 없었다).
 */
export async function restoreLeaveBalance(db: Db, userId: string, year: number, days: number): Promise<RestoreOutcome> {
  // 보통은 사용이 충분하다 — 조건부로 한 번에
  const r = await db.leaveBalance.updateMany({
    where: { userId, year, used: { gte: days - 1e-9 } },
    data: { used: { decrement: days }, remaining: { increment: days } },
  });
  if (r.count > 0) return { year, wanted: days, restored: days, status: "ok" };
  const row = await db.leaveBalance.findUnique({ where: { userId_year: { userId, year } }, select: { used: true } });
  if (!row) return { year, wanted: days, restored: 0, status: "missing" };
  const amt = Math.max(0, row.used);   // 남은 사용 그대로(반올림 없음)
  if (amt > 0) {
    const u = await db.leaveBalance.updateMany({
      where: { userId, year, used: row.used },   // 읽은 값 그대로일 때만(그 사이 바뀌면 복구하지 않고 clamped 0 으로 알린다)
      data: { used: { decrement: amt }, remaining: { increment: amt } },
    });
    if (u.count === 0) return { year, wanted: days, restored: 0, status: "clamped" };
  }
  return { year, wanted: days, restored: amt, status: "clamped" };
}

/**
 * **그 해 잔여** — 휴가 신청 검사(POST /api/leave)와 신청 화면의 "N년 잔여" 표시가 같이 쓴다(9/11 디렉터: 내년 날짜를
 * 고르면 내년 잔여를 따로 보여준다). 화면과 서버가 다른 값을 쓰면 "화면엔 남았는데 신청은 거절"이 된다.
 * - 그 해 행이 있으면 그 행.
 * - 올해·내년인데 행이 없으면(12월에 내년 신청, 1월 연도 전환 전) 연초 이월과 같은 근속 기준 총연차, 사용 0.
 * - 지난 해에 행이 없으면 null — 검사하지 않는다(종전 규칙, 9/11 디렉터 "그대로").
 */
export async function yearBalanceFor(
  db: Db, userId: string, year: number
): Promise<{ total: number; used: number; remaining: number } | null> {
  const row = await db.leaveBalance.findUnique({
    where: { userId_year: { userId, year } },
    select: { total: true, used: true, remaining: true },
  });
  if (row) return row;
  if (year < currentLeaveYear()) return null;
  const total = await defaultYearTotal(db, userId, year);
  return { total, used: 0, remaining: total };
}

/**
 * 휴가 한 건 차감 — 해마다 몫(lib/leave-days leaveDaysByYear)으로 나눠 그 해 행마다 deductLeaveBalance, 그리고
 * **실제 차감한 몫을 그 휴가에 저장**(deductedByYear — 같은 트랜잭션). 모든 차감 경로(자동승인·대리등록·단계 최종승인·
 * 관리자 직접처리·시프티 가져오기)가 이 함수를 쓴다. 신청 때 센 근무일로 이미 나눴으면 byYear 로 넘긴다(DB 를 다시 보지 않게).
 */
export async function deductLeave(db: Db, leave: LeaveSpan & { id: string }, byYear?: Map<number, number>): Promise<Map<number, number>> {
  const split = byYear ?? (await leaveDaysByYear(db, leave));
  for (const [year, days] of [...split].sort((a, b) => a[0] - b[0])) if (days > 0) await deductLeaveBalance(db, leave.userId, year, days);
  await db.leaveRequest.update({ where: { id: leave.id }, data: { deductedByYear: byYearToJson(split) } });
  return split;
}

/**
 * 휴가 한 건 복구 — **차감 때 저장한 몫**(없으면 옛 규칙: 시작 해에 days)으로 그 해 행마다 restoreLeaveBalance.
 * 다시 나누지 않는다 — 그 사이 근무일정이 바뀌어도 차감한 만큼만 돌아온다.
 * deductedByYear 는 **지우지 않는다**: 복구한 휴가는 CANCELLED(취소)·삭제(가져오기 되돌리기)로 끝나 다시 승인되는 경로가 없고,
 * 대장·정산·리포트는 APPROVED 만 센다. 남겨 두면 「무엇을 차감했다가 돌려줬는지」 근거가 된다. 앞으로 재승인 경로가 생겨도
 * 그 차감은 deductLeave 를 거치므로 값을 새로 덮어쓴다.
 * restored = 실제 복구 합, outcomes = 해마다 결과(행 없음·0 하한 포함), text = 감사 문구(실제 복구한 값만 「복구」로).
 */
export async function restoreLeave(db: Db, leave: ApprovedSpan & { userId: string }): Promise<{ restored: number; outcomes: RestoreOutcome[]; text: string }> {
  const split = approvedDaysByYear(leave);
  const outcomes: RestoreOutcome[] = [];
  for (const [year, days] of [...split].sort((a, b) => a[0] - b[0])) if (days > 0) outcomes.push(await restoreLeaveBalance(db, leave.userId, year, days));
  const restored = Math.round(outcomes.reduce((a, o) => a + o.restored, 0) * 1e9) / 1e9;   // 부동소수 찌꺼기만 지운다
  return { restored, outcomes, text: restoreText(outcomes) };
}

/** 복구 결과 문구 — 「2025년 1일 복구 · 2026년 연차 기록 없음(복구 안 함)」·「2027년 0.5일만 복구(1일 중 — 사용이 0 아래로 내려가지 않게 멈춤)」 */
export function restoreText(outcomes: RestoreOutcome[]): string {
  return outcomes.map((o) =>
    o.status === "ok" ? `${o.year}년 ${o.restored}일 복구`
      : o.status === "missing" ? `${o.year}년 연차 기록 없음(복구 안 함)`
      : `${o.year}년 ${o.restored}일만 복구(${o.wanted}일 중 — 사용이 0 아래로 내려가지 않게 멈춤)`
  ).join(" · ");
}

/** 해마다 몫을 「2026년 1일 · 2027년 1일」 로 — 안내·감사 문구용 */
export function byYearText(byYear: Map<number, number>): string {
  return [...byYear].sort((a, b) => a[0] - b[0]).map(([y, d]) => `${y}년 ${d}일`).join(" · ");
}
