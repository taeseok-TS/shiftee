import { prisma } from "./db";

// Expo Push API 로 푸시 알림을 보낸다.
// 토큰 등록은 모바일 앱이 로그인 후 /api/push/register 로 수행.
// 본 작업(메시지 저장 등)을 막지 않도록 호출부에서 await 없이 fire-and-forget 으로 쓴다.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound: "default"; // iOS 소리 (Android는 채널이 소리 담당)
  priority: "high"; // 즉시 전달 + 기기 깨우기
  channelId: string; // Android: 이 id의 채널로 라우팅(앱의 'messages' 채널과 일치해야 소리/진동)
};

// 여러 사용자에게 같은 알림을 발송. 토큰이 없으면 조용히 통과.
export async function sendPushToUsers(
  userIds: string[],
  payload: { title: string; body: string; data?: Record<string, unknown> }
): Promise<void> {
  if (userIds.length === 0) return;

  const tokens = await prisma.pushToken.findMany({
    where: { userId: { in: userIds } },
    select: { token: true },
  });
  if (tokens.length === 0) return;

  const messages: PushMessage[] = tokens.map((t) => ({
    to: t.token,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound: "default",
    priority: "high",
    channelId: "messages",
  }));

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      console.error("[push] Expo push 발송 실패:", res.status, await res.text());
      return;
    }
    // DeviceNotRegistered 등 무효 토큰 정리
    const json = (await res.json()) as {
      data?: { status: string; details?: { error?: string } }[];
    };
    const dead: string[] = [];
    json.data?.forEach((ticket, i) => {
      if (
        ticket.status === "error" &&
        ticket.details?.error === "DeviceNotRegistered"
      ) {
        dead.push(messages[i].to);
      }
    });
    if (dead.length > 0) {
      await prisma.pushToken
        .deleteMany({ where: { token: { in: dead } } })
        .catch(() => {});
    }
  } catch (e) {
    console.error("[push] Expo push 요청 오류:", e);
  }
}
