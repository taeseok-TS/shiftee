import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { currentLeaveYear } from "@/lib/leave-calc";
import { kstDate, yearTotalAsOf } from "@/lib/leave-accrual";

// 입사일이 바뀌면 올해 연차 총량을 근속으로 다시 센다(2026-10-08) — 「연차 자동계산」(api/leave/balance/recalc)과 같은 규칙:
// 올해 행만, 사용은 그대로, 잔여 = max(0, 총 − 사용), 총량이 바뀔 때만 감사 기록. 입사일 대조표(#5)와 포털 인사명부 반영이 같이 쓴다.
export async function recalcYearBalanceForHire(
  user: { id: string; name: string }, hireDate: Date, actor: { id: string; name: string }, reason: string,
): Promise<{ total: number; used: number; remaining: number; warning: string | null }> {
  const year = currentLeaveYear();
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { resignDate: true } });
  const total = yearTotalAsOf(kstDate(hireDate), year, undefined, u?.resignDate ? kstDate(u.resignDate) : null);   // 회계연도 기준 오늘까지 발생(2026-10-16 #31)
  const bal = await prisma.leaveBalance.findUnique({ where: { userId_year: { userId: user.id, year } }, select: { used: true, total: true } });
  // 잔여 = 총 − 사용(0 으로 자르지 않는다 — 자르면 뒤의 자동 맞춤이 더한 만큼 더 쓸 수 있게 된다, 검증 N1-b). 넘침은 warning 으로 알린다
  const used = bal?.used ?? 0, remaining = total - used;
  await prisma.leaveBalance.upsert({ where: { userId_year: { userId: user.id, year } }, create: { userId: user.id, year, total, accruedAuto: total, used, remaining }, update: { total, accruedAuto: total, remaining } });
  if (!bal || bal.total !== total) {
    await logAudit({ actorId: actor.id, actorName: actor.name, action: "LEAVE_BALANCE_UPDATE", targetType: "USER", targetId: user.id, targetName: user.name,
      detail: `(${reason} ${year}년) 연차 총 ${bal?.total ?? "-"}→${total}일, 사용 ${used}일, 잔여 ${remaining}일` });
  }
  return { total, used, remaining, warning: total < used ? `${user.name}: 새 입사일 기준 올해 총 연차 ${total}일 < 이미 사용 ${used}일 — 잔여 ${remaining}일` : null };
}
