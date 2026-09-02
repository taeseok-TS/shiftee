// 채널 접근 판정 — 그룹채널·DM 은 멤버만 (2026-09-02)
// messages 라우트에만 있던 검사를 첨부 목록·ZIP 다운로드 라우트에서도 쓰려고 뽑았다.
// 그 둘에 검사가 없어서 로그인만 하면 남의 DM 첨부까지 받아졌다.
import { prisma } from "@/lib/db";

export async function assertChannelAccess(
  channelId: string,
  userId: string
): Promise<{ ok: boolean; name: string; status: number; error: string }> {
  const channel = await prisma.workChannel.findUnique({
    where: { id: channelId },
    select: { name: true, isDefault: true, members: { select: { userId: true } } },
  });
  if (!channel) return { ok: false, name: "", status: 404, error: "채널을 찾을 수 없습니다." };
  const isMember = channel.members.some((m) => m.userId === userId);
  if (!channel.isDefault && !isMember)
    return { ok: false, name: "", status: 403, error: "접근 권한이 없습니다." };
  return { ok: true, name: channel.name, status: 200, error: "" };
}
