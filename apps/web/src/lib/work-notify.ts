// 새 채팅 메시지 푸시 알림 — channels/[id]/messages 라우트의 비공개 함수를 그대로 옮겨 export 한 것(2026-10-26).
// 「한 번에 보내기」(/api/work/broadcast)가 같은 규칙으로 푸시를 보내야 해서 꺼냈다. 동작·시그니처는 그대로다.
// 규칙: 발신자 제외, MUTE 제외, MENTION 이면 멘션 시만. 미리보기 문구는 lib/bot.ts 의 예약 전송과도 같다.
import { prisma } from "@/lib/db";
import { sendPushToUsers } from "@/lib/push";
import { isMentioned } from "@/lib/mention";

// 새 메시지에 대한 푸시 알림 발송
export async function notifyNewMessage(
  channel: { id: string; name: string; type: string },
  message: { id: string; content: string; fileUrl: string | null; user: { name: string } },
  senderId: string
) {
  const members = await prisma.workChannelMember.findMany({
    where: { channelId: channel.id, userId: { not: senderId } },
    select: { userId: true, notify: true, user: { select: { name: true } } },
  });

  const recipients = members
    .filter((m) => m.notify !== "MUTE")
    .filter((m) =>
      m.notify === "MENTION" ? isMentioned(message.content, m.user.name) : true
    )
    .map((m) => m.userId);

  const albumCount = Array.isArray((message as { albumUrls?: unknown }).albumUrls)
    ? ((message as { albumUrls?: unknown[] }).albumUrls as unknown[]).length
    : 0;
  const preview = message.content?.trim()
    ? message.content.trim()
    : albumCount > 0
    ? `사진 ${albumCount}장을 보냈습니다.`
    : (message as { fileType?: string | null }).fileType === "audio"
    ? "음성 메시지를 보냈습니다."
    : (message as { fileType?: string | null }).fileType === "sticker"
    ? "이모티콘을 보냈습니다."
    : message.fileUrl
    ? "사진/파일을 보냈습니다."
    : "";

  await sendPushToUsers(recipients, {
    title: channel.name,
    body: `${message.user.name}: ${preview}`,
    // 알림을 누르면 앱이 이 값으로 해당 채팅방(그리고 그 메시지)까지 바로 연다
    data: { channelId: channel.id, channelName: channel.name, channelType: channel.type, messageId: message.id, type: "work-message" },
  }, { respectWorkMute: true, withWorkBadge: true });
}
