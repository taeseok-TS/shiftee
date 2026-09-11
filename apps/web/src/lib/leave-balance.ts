import type { Prisma } from "@prisma/client";
import { annualLeaveDays } from "@/lib/leave-calc";

/**
 * 연차 **차감·복구는 여기 두 함수로만** 한다(2026-09-11). 종전에는 차감이 세 곳(휴가 신청 자동승인 ·
 * 단계 최종승인 · 관리자 직접처리)에 복붙돼 있어 한 곳만 고치면 어긋났다.
 *
 * 연도는 호출부가 `leaveYearOfLeave(휴가 시작일)` 로 넘긴다 — "휴가를 쓰는 해" 기준(디렉터 9/11).
 *
 * ⚠ 그 해 행이 없으면 **연초 이월(api/leave/rollover)과 같은 계산**으로 만든다(근속, 그 해 1월 1일 기준).
 *   기본값 15 로 만들면 1월 이월이 "행 있음"으로 건너뛰어 근속 재부여가 빠진다. 이월 계산을 바꾸면 여기도.
 */
type Db = Prisma.TransactionClient;

/** 그 해 연차 행이 없을 때의 총연차 — 연초 이월과 같은 계산(입사일 없으면 15, 음수는 0) */
export async function defaultYearTotal(db: Db, userId: string, year: number): Promise<number> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { hireDate: true } });
  if (!u?.hireDate) return 15;
  return Math.max(0, annualLeaveDays(new Date(u.hireDate), new Date(year, 0, 1)));
}

/** 연차 차감 — 그 해 행에서. 행이 없으면 이월과 같은 총연차로 만든 뒤 차감한다. */
export async function deductLeaveBalance(db: Db, userId: string, year: number, days: number): Promise<void> {
  const total = await defaultYearTotal(db, userId, year);   // 행이 있으면 쓰이지 않는다(upsert create 용)
  await db.leaveBalance.upsert({
    where: { userId_year: { userId, year } },
    create: { userId, year, total, used: days, remaining: total - days },
    update: { used: { increment: days }, remaining: { decrement: days } },
  });
}

/** 연차 복구 — 차감과 같은 해 행에. 행이 없으면 0(복구할 차감이 없었다). 복구한 일수를 돌려준다. */
export async function restoreLeaveBalance(db: Db, userId: string, year: number, days: number): Promise<number> {
  const r = await db.leaveBalance.updateMany({
    where: { userId, year },
    data: { used: { decrement: days }, remaining: { increment: days } },
  });
  return r.count > 0 ? days : 0;
}
