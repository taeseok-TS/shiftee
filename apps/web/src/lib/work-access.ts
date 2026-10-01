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

/**
 * 그 방의 실시간 신호를 받을 사람 — 전체(기본) 채널이면 모두, 아니면 멤버.
 *
 * 실시간 스트림(/api/work/stream)이 종전에는 **모든 방의 신호를 로그인한 전원에게** 보냈다(방 id·보낸 사람·메시지 id,
 * 입력 중인 사람 이름). 내용은 없지만 "누가 어느 방에서 누구와 이야기하는지"와 메시지 id 가 새어 나갔다(2026-09-30 검증관).
 * 신호 하나마다 접속자 수만큼 DB 를 읽지 않게, **방 단위로** 3초 동안 기억한다(같은 방 조회는 동시에 한 번만).
 * 3초 동안은 방금 들어온 사람이 신호를 놓치거나 방금 나간 사람이 신호를 받을 수 있다 — 신호일 뿐이고
 * 메시지 조회는 매번 멤버 검사를 하므로 새는 내용은 없다. 새로 만든 방은 기억이 없어 바로 읽는다.
 */
const AUDIENCE_TTL_MS = 3000;
type Audience = { isDefault: boolean; members: Set<string> };
type AudienceEntry = { at: number; value?: Audience; loading?: Promise<Audience> };
const ga = globalThis as unknown as { __workAudience?: Map<string, AudienceEntry> };
const audienceCache: Map<string, AudienceEntry> = ga.__workAudience ?? (ga.__workAudience = new Map());

export function channelAudience(channelId: string, now: number = Date.now()): Promise<Audience> {
  const hit = audienceCache.get(channelId);
  if (hit?.value && now - hit.at < AUDIENCE_TTL_MS) return Promise.resolve(hit.value);
  if (hit?.loading) return hit.loading;
  const loading = prisma.workChannel
    .findUnique({ where: { id: channelId }, select: { isDefault: true, members: { select: { userId: true } } } })
    .then((c): Audience => {
      const value: Audience = { isDefault: !!c?.isDefault, members: new Set((c?.members ?? []).map((m) => m.userId)) };
      audienceCache.set(channelId, { at: Date.now(), value });
      return value;
    })
    .catch((e) => {
      audienceCache.delete(channelId); // 실패는 기억하지 않는다 — 다음 신호에서 다시 읽는다
      throw e;
    });
  audienceCache.set(channelId, { at: hit?.at ?? 0, value: hit?.value, loading });
  // 오래된 방 기억 청소(방이 많아져도 메모리가 늘지 않게)
  if (audienceCache.size > 2000) for (const [k, v] of audienceCache) if (!v.loading && now - v.at > 60_000) audienceCache.delete(k);
  return loading;
}

/** 이 사람이 그 방의 실시간 신호를 받아도 되는가 */
export async function canReceiveChannelEvent(channelId: string, userId: string): Promise<boolean> {
  const a = await channelAudience(channelId);
  return a.isDefault || a.members.has(userId);
}

/** 실시간 신호 수신 대상 기억을 지운다 — 멤버를 넣거나 뺀 직후 부른다(3초 동안 새 멤버가 신호를 놓치지 않게) */
export function invalidateChannelAudience(channelId: string): void {
  audienceCache.delete(channelId);
}

/**
 * 메시지 하나를 볼 수 있는가 — **방 접근 + 과거 기록 범위**(2026-10-01).
 *
 * "과거 기록 없이 초대"한 멤버(historyFrom)는 그 시각 이전 글을 보면 안 되는데, 메시지 목록·링크만 그 규칙을
 * 지키고 검색·파일·답글·멘션·보관함·답장 인용은 지키지 않았다. 메시지 하나를 다루는 라우트는 모두 이것을 쓴다.
 * 범위 밖이면 "없는 메시지"(404)로 답한다 — 있다는 사실도 알리지 않게.
 */
type AccessibleMessage = { id: string; channelId: string; userId: string; createdAt: Date; deletedAt: Date | null; fileType: string | null };
// 실패 칸(status·error)을 늘 함께 둔다 — strictNullChecks 가 꺼진 파일에서는 ok 로 나눠도 좁혀지지 않는다
export async function assertMessageAccess(messageId: string, userId: string): Promise<{ ok: boolean; status: number; error: string; message?: AccessibleMessage }> {
  const m = await prisma.workMessage.findUnique({
    where: { id: messageId },
    select: { id: true, channelId: true, userId: true, createdAt: true, deletedAt: true, fileType: true, channel: { select: { isDefault: true } } },
  });
  if (!m) return { ok: false, status: 404, error: "메시지를 찾을 수 없습니다." };
  const me = await prisma.workChannelMember.findUnique({
    where: { channelId_userId: { channelId: m.channelId, userId } },
    select: { historyFrom: true },
  });
  if (!m.channel.isDefault && !me) return { ok: false, status: 403, error: "접근 권한이 없습니다." };
  if (me?.historyFrom && m.createdAt < me.historyFrom) return { ok: false, status: 404, error: "메시지를 찾을 수 없습니다." };
  const { channel: _c, ...message } = m;
  void _c;
  return { ok: true, status: 200, error: "", message };
}

/** 그 방에서 내가 볼 수 있는 가장 이른 시각(과거 기록 범위). null 이면 전체 */
export async function myHistoryFrom(channelId: string, userId: string): Promise<Date | null> {
  const me = await prisma.workChannelMember.findUnique({
    where: { channelId_userId: { channelId, userId } },
    select: { historyFrom: true },
  });
  return me?.historyFrom ?? null;
}

/** 여러 방의 내 열람 시작 시각 — 방 id → historyFrom(없으면 키 없음) */
export async function myHistoryFromMap(userId: string, channelIds?: string[]): Promise<Map<string, Date>> {
  const rows = await prisma.workChannelMember.findMany({
    where: { userId, historyFrom: { not: null }, ...(channelIds ? { channelId: { in: channelIds } } : {}) },
    select: { channelId: true, historyFrom: true },
  });
  return new Map(rows.map((r) => [r.channelId, r.historyFrom as Date]));
}
