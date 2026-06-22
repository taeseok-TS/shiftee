import { prisma } from "@/lib/db";

/**
 * 채널 관리 권한: 관리자/원장(ADMIN/MANAGER), 채널 생성자, 또는 방장(isManager)
 */
export async function channelCanManage(channelId: string, userId: string, role: string): Promise<boolean> {
  if (role === "ADMIN" || role === "MANAGER") return true;
  const ch = await prisma.workChannel.findUnique({ where: { id: channelId }, select: { createdBy: true } });
  if (ch?.createdBy === userId) return true;
  const m = await prisma.workChannelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { isManager: true },
  });
  return !!m?.isManager;
}
