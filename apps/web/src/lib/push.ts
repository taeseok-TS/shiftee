import { prisma } from "./db";
import { isResigned } from "./resign";
import { getWorkUnreadTotal } from "./work-unread";

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
  badge?: number; // iOS 앱 아이콘 뱃지(카톡식 미확인 수) — OS가 직접 설정
};

// 여러 사용자에게 같은 알림을 발송. 토큰이 없으면 조용히 통과.
// respectWorkMute: 큐브티워크 채팅류(메시지·투표·공지·예약전송) 푸시 — 전체 알림 끈(workMuteAll) 사용자 제외.
// withWorkBadge: 수신자별 미확인 총수를 계산해 iOS 앱 아이콘 뱃지로 설정(카톡식).
// 결재 DM·중요공지 재알림 등은 respectWorkMute 없이 호출해 기존대로 발송.
export async function sendPushToUsers(
  userIds: string[],
  payload: { title: string; body: string; data?: Record<string, unknown> },
  opts?: { respectWorkMute?: boolean; withWorkBadge?: boolean }
): Promise<void> {
  if (userIds.length === 0) return;

  // 퇴사.비활성 계정에는 보내지 않는다. 세션은 끊겨도 옛 푸시 등록이 남아 있으면
  // 채팅 **본문 미리보기**가 계속 간다(2026-09-08 9차 검증에서 운영 실측 — 비활성
  // 계정 단말 2대가 4개 채널의 새 메시지를 계속 받고 있었다).
  // 무효화 시점에 등록을 지우는 것이 1차 방어이고, 이건 이미 남아 있는 것에 대한 2차 방어다.
  const alive = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, isActive: true, resignDate: true },
  });
  const aliveSet = new Set(alive.filter((u) => u.isActive && !isResigned(u.resignDate)).map((u) => u.id));
  let targetIds = userIds.filter((id) => aliveSet.has(id));
  if (targetIds.length === 0) return;

  if (opts?.respectWorkMute) {
    const muted = await prisma.user.findMany({
      where: { id: { in: targetIds }, workMuteAll: true },
      select: { id: true },
    });
    if (muted.length > 0) {
      const mutedSet = new Set(muted.map((m) => m.id));
      targetIds = targetIds.filter((id) => !mutedSet.has(id));
    }
    if (targetIds.length === 0) return;
  }

  const tokens = await prisma.pushToken.findMany({
    where: { userId: { in: targetIds } },
    select: { token: true, userId: true },
  });
  if (tokens.length === 0) return;

  // 수신자별 앱 아이콘 뱃지(미확인 총수) — 실패해도 푸시 자체는 발송
  const badgeByUser = new Map<string, number>();
  if (opts?.withWorkBadge) {
    try {
      const userIdsWithToken = [...new Set(tokens.map((t) => t.userId))];
      const users = await prisma.user.findMany({
        where: { id: { in: userIdsWithToken } },
        select: { id: true, name: true },
      });
      await Promise.all(users.map(async (u) => {
        badgeByUser.set(u.id, await getWorkUnreadTotal(u.id, u.name));
      }));
    } catch (e) {
      console.error("[push] 뱃지 계산 오류:", e);
    }
  }

  const messages: PushMessage[] = tokens.map((t) => ({
    to: t.token,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound: "default",
    priority: "high",
    channelId: "messages",
    ...(badgeByUser.has(t.userId) ? { badge: badgeByUser.get(t.userId) } : {}),
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
