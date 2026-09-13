// 채팅방에 메시지 올리기 — /api/v1 (개인 API 키) 경로용 (2026-09-13)
//
// 화면이 쓰는 messages 라우트의 POST 와 같은 일을 한다(생성 → SSE 신호 → 푸시). 라우트 파일은
// 핸들러 외 export 가 안 되어 여기에 최소한만 옮겨 적었다 — 라우트의 푸시 규칙(MUTE 제외, MENTION 은 멘션 시만)과 같다.
// 키로 올린 메시지는 본문 앞에 "🤖 " 를 붙여 웹·앱 어디서나 "자동"임이 보이고, apiKeyId 로 감사에 남는다.
import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";
import { sendPushToUsers } from "@/lib/push";
import { isMentioned } from "@/lib/mention";

export const BOT_MARK = "🤖 ";

/** 본인이 속한 방인가 (기본 '전체' 방은 모두) — 매 요청마다 다시 본다(방에서 빠지면 그 순간 막힌다) */
export async function channelAccessible(channelId: string, userId: string) {
  const ch = await prisma.workChannel.findFirst({
    where: { id: channelId, deletedAt: null, hidden: false },
    select: { id: true, name: true, type: true, isDefault: true, members: { where: { userId }, select: { userId: true } } },
  });
  if (!ch) return null;
  if (!ch.isDefault && ch.members.length === 0) return null;
  return ch;
}

export async function postChannelMessage(opts: { channelId: string; userId: string; content: string; apiKeyId: string }) {
  const ch = await channelAccessible(opts.channelId, opts.userId);
  if (!ch) return { error: "속해 있지 않은 방입니다.", status: 403 as const };
  const content = BOT_MARK + opts.content.trim();
  const message = await prisma.workMessage.create({
    data: { channelId: ch.id, userId: opts.userId, content, apiKeyId: opts.apiKeyId },
    include: { user: { select: { name: true } } },
  });
  emitWork({ type: "message", channelId: ch.id, senderId: opts.userId, msgId: message.id });
  // 푸시(발신자 제외·MUTE 제외·MENTION 은 멘션 시만) — 응답을 막지 않는다
  void (async () => {
    try {
      const members = await prisma.workChannelMember.findMany({
        where: { channelId: ch.id, userId: { not: opts.userId } },
        select: { userId: true, notify: true, user: { select: { name: true } } },
      });
      const recipients = members
        .filter((m) => m.notify !== "MUTE")
        .filter((m) => (m.notify === "MENTION" ? isMentioned(content, m.user.name) : true))
        .map((m) => m.userId);
      await sendPushToUsers(recipients, {
        title: ch.name,
        body: `${message.user.name}: ${content}`,
        data: { channelId: ch.id, channelName: ch.name, channelType: ch.type, messageId: message.id, type: "work-message" },
      }, { respectWorkMute: true, withWorkBadge: true });
    } catch (e) { console.error("[v1 chat] 푸시 오류:", e); }
  })();
  return { message: { id: message.id, channelId: ch.id, content, createdAt: message.createdAt } };
}
