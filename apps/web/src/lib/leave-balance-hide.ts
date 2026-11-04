import { prisma } from "@/lib/db";
import { canSeeLeaveBalance } from "@/lib/permission-settings";

// 사람별 연차 숫자 숨김 · 자동 맞춤 제외(2026-11-04 정인 「2026 연차 정리」 — 디렉터 「처리하고」).
//  · 숨김: 휴직·퇴사 예정·잔여 마이너스 직원은 「잔여 연차 숫자 보기」를 켜도 직원·원장 화면에 그 사람 숫자를 내지 않는다(화면은 「연차 정리 중」).
//    본부(ADMIN)는 언제나 본다. 데이터는 그대로 — 표시만. AppSetting `leave.hiddenBalanceUsers` (사용자 id JSON 배열)
//  · 자동 맞춤 제외: 회사 정산 기준으로 그 해 총 연차를 확정한 사람은 매시 자동 맞춤(lib/leave-accrual-run)이 더하지 않는다.
//    큐브티 식은 2025-12 입사자에게 11/22 월차 1일을 더 붙이는데, 회사 값은 월차 11일을 이미 넣은 값이라 넘쳤다.
//    AppSetting `leave.accrualLocked:<해>` (사용자 id JSON 배열). 2027 부터는 회사 식으로 자동 계산하기로(정인 요청) — 그때 다시 본다
export const HIDE_KEY = "leave.hiddenBalanceUsers";
export const lockKey = (year: number) => `leave.accrualLocked:${year}`;

async function readIds(key: string): Promise<Set<string>> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return new Set();
  try {
    const v = JSON.parse(row.value);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** 목록에 한 사람을 넣거나 뺀다 — 본부 둘이 동시에 고쳐도 한쪽이 사라지지 않게 그 키를 잠그고 읽고·쓴다(검증 3). 바뀌었으면 true */
export async function setListed(key: string, userId: string, on: boolean): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const row = await tx.appSetting.findUnique({ where: { key } });
    let ids: string[] = [];
    try { const v = row ? JSON.parse(row.value) : []; ids = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { ids = []; }
    const set = new Set(ids);
    if (set.has(userId) === on) return false;
    if (on) set.add(userId); else set.delete(userId);
    const value = JSON.stringify([...set].sort());
    await tx.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
    return true;
  });
}

/** 자동 맞춤 제외를 켜거나 끌 때 그 해 행의 「자동으로 들어간 몫」을 지금 계산값으로 맞춘다 — 안 맞추면 풀 때 그동안 생긴 월차가
 *  확정값 위에 한꺼번에 더해졌다(검증 5). 총 연차는 건드리지 않는다 */
export async function resetAccruedAuto(userId: string, year: number): Promise<void> {
  const { kstDate, yearTotalAsOf } = await import("@/lib/leave-accrual");
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { hireDate: true, resignDate: true } });
  if (!u?.hireDate) return;
  const want = yearTotalAsOf(kstDate(u.hireDate), year, undefined, u.resignDate ? kstDate(u.resignDate) : null);
  await prisma.leaveBalance.updateMany({ where: { userId, year }, data: { accruedAuto: want } });
}

export const hiddenBalanceUserIds = () => readIds(HIDE_KEY);
export const accrualLockedUserIds = (year: number) => readIds(lockKey(year));

/** 이 사람(subject)의 연차 숫자를 이 역할에게 보여도 되나 — 본부는 언제나, 직원·원장은 스위치가 켜졌고 그 사람이 숨김이 아닐 때만 */
export async function canSeeLeaveBalanceOf(role: string, subjectUserId: string): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (!(await canSeeLeaveBalance(role))) return false;
  return !(await hiddenBalanceUserIds()).has(subjectUserId);
}
