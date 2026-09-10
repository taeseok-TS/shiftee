import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { kstTodayMidnight } from "@/lib/resign";
import type { CancelViewer } from "@/lib/leave-cancel";

/**
 * 취소 판정(lib/leave-cancel.ts)에 넘길 "보는 사람" 정보 — 서버 전용.
 *
 * 취소 라우트 · 목록 · 결재함 API 가 **모두 이 함수로** 만든다. 곳곳에서 따로 만들면
 * 한 곳만 메인 원장 조건이나 오늘 날짜를 빠뜨린다(짝 누락이 이 작업의 반복 결함이다).
 *
 * 메인 원장 = `Branch.mainManagerId`. 그 지점을 떠나면 `syncMainManagerFor` 가 비우므로,
 * 여기서는 지정된 지점 이름만 모은다. 담당 지점에 들어 있는지는 판정 쪽이 따로 본다.
 */
export async function cancelViewerFor(session: { userId: string; role: string }): Promise<CancelViewer> {
  const today = kstTodayMidnight();
  if (session.role !== "MANAGER") {
    return { userId: session.userId, role: session.role, myBranches: [], mainBranches: [], today };
  }
  const [myBranches, mains] = await Promise.all([
    getManagerBranches(session.userId),
    prisma.branch.findMany({
      where: { mainManagerId: session.userId, isActive: true },
      select: { name: true },
    }),
  ]);
  return {
    userId: session.userId,
    role: session.role,
    myBranches,
    mainBranches: mains.map((b) => b.name),
    today,
  };
}
