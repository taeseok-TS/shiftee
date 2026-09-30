import { prisma } from "@/lib/db";

/**
 * 채널 관리 권한: 본부 관리자(ADMIN), 채널 생성자, 방장(isManager), 그리고 **그 방에 속한** 원장(MANAGER).
 *
 * ⚠ 원장은 자기가 속한 방만 관리한다(2026-09-30 디렉터). 종전에는 역할만으로 모든 그룹방을 관리할 수 있어,
 *   방 id 만 알면 속하지 않은 방에 스스로 들어가 대화를 읽거나(멤버 추가), 남의 방을 지우고 사람을 내보낼 수 있었다.
 *   화면에는 그런 버튼이 없지만 요청을 직접 보내면 됐다. 본부 관리자는 종전대로 전체.
 */
export async function channelCanManage(channelId: string, userId: string, role: string): Promise<boolean> {
  if (role === "ADMIN") return true;
  const ch = await prisma.workChannel.findUnique({ where: { id: channelId }, select: { createdBy: true } });
  if (ch?.createdBy === userId) return true;
  const m = await prisma.workChannelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { isManager: true },
  });
  if (!m) return false;
  return m.isManager || role === "MANAGER";
}

/** 그 방의 멤버인가 */
export async function isChannelMember(channelId: string, userId: string): Promise<boolean> {
  const m = await prisma.workChannelMember.findUnique({ where: { channelId_userId: { channelId, userId } }, select: { userId: true } });
  return !!m;
}
