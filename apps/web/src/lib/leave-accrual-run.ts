import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { kstDate, kstToday, roundTo, yearTotalAsOf } from "@/lib/leave-accrual";
import { currentLeaveYear } from "@/lib/leave-calc";

// 연차 자동 맞춤(2026-10-16 #31, 디렉터 결정 「오늘까지 생긴 만큼 + 매일 자동」) — 봇 스케줄러가 매시 1회 부른다.
// 행마다 「자동으로 들어간 몫」(LeaveBalance.accruedAuto)을 기억해 두고, 지금 계산값(회계연도 기준 기준일까지 발생)과의 **차이만**
// 총연차·잔여에 더한다. 그래서
//  - 몇 번을 돌려도, 틱을 놓쳐도, 행이 언제 만들어졌어도 결과가 같다(검증 C1·C3 — 종전 「지난 실행일 이후 월차만 더하기」는 어긋났다)
//  - 본부가 손으로 맞춘 몫(총연차 − accruedAuto)은 그대로 남는다
//  - 입사일이 바뀌면 차이가 음수가 될 수 있다 — 그대로 반영한다(검증 P2)
//  - 퇴사일 뒤로는 발생하지 않는다(검증 C4)
// accruedAuto 가 비어 있는 행(옛 행·일괄 업로드로 만든 행)은 지금 계산값을 기준으로만 적어 두고 총연차는 건드리지 않는다.
// 대상 해는 올해, 그리고 1월에만 지난해(12월 말 월차가 늦게 맞춰질 수 있게 — 그 뒤 지난해 행은 정산이 끝났을 수 있어 건드리지 않는다).
// 내년 행(12월에 미리 만든 행)은 1/1 이 되면 올해로 맞춘다. 대상은 재직자(isActive)만 — 비활성 처리된 사람은 그 시점 값에서 멈춘다.

export async function runAccrualSync(): Promise<{ changed: number; initialized: number; failed: number }> {
  const today = kstToday();
  const year = currentLeaveYear();
  const years = today.slice(5, 7) === "01" ? [year - 1, year] : [year];
  const rows = await prisma.leaveBalance.findMany({
    where: { year: { in: years }, user: { isActive: true, deletedAt: null, hireDate: { not: null } } },
    select: { id: true, year: true, total: true, remaining: true, accruedAuto: true, user: { select: { id: true, name: true, hireDate: true, resignDate: true } } },
  });
  let changed = 0, initialized = 0, failed = 0;
  for (const r of rows) {
    try {
      const hire = kstDate(r.user.hireDate!);
      const resign = r.user.resignDate ? kstDate(r.user.resignDate) : null;
      const want = yearTotalAsOf(hire, r.year, today, resign);
      if (r.accruedAuto == null) {
        await prisma.leaveBalance.updateMany({ where: { id: r.id, accruedAuto: null }, data: { accruedAuto: want } });
        initialized++;
        continue;
      }
      const delta = roundTo(want - r.accruedAuto, 2);
      if (delta === 0) continue;
      // 읽은 값 그대로일 때만 바꾼다 — 그 사이 다른 곳이 맞췄으면 다음 실행에 다시 본다
      const u = await prisma.leaveBalance.updateMany({
        where: { id: r.id, accruedAuto: r.accruedAuto },
        data: { accruedAuto: want, total: { increment: delta }, remaining: { increment: delta } },
      });
      if (u.count === 0) continue;
      changed++;
      await logAudit({
        actorId: "cubetee-bot", actorName: "큐브티 봇", action: "LEAVE_BALANCE_UPDATE", targetType: "USER", targetId: r.user.id, targetName: r.user.name,
        detail: `(연차 자동 맞춤 ${r.year}년, 회계연도 기준 ${today} 현재) 발생 ${r.accruedAuto}→${want}일, 총연차 ${r.total}→${roundTo(r.total + delta, 2)}일 (${delta > 0 ? "+" : ""}${delta}일)`,
      }).catch(() => {});
    } catch (e) {
      failed++;   // 한 사람 실패가 나머지를 막지 않는다 — 다음 실행에 다시 맞춘다(검증 P1)
      console.error("[leave-accrual] 자동 맞춤 실패:", r.user.name, e);
    }
  }
  return { changed, initialized, failed };
}
