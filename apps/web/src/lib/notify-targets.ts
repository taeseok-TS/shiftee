// 관리자 알림 수신자 (2026-09-03)
//
// 종전에는 관리자 전원(7명)에게 뿌렸다. 시스템 오류는 담당자만 보면 되고, 나머지에게는
// 소음이다. 담당자는 바뀌므로 **코드가 아니라 설정에서** 고를 수 있어야 한다.
//
// 저장은 AppSetting(key/value)에 JSON 배열로 한다 — 결재 알림 정책이 이미 쓰는 방식이라
// 스키마 변경도, 운영 DB 마이그레이션도 필요 없다(스키마 드리프트 사고를 여러 번 냈다).
import { prisma } from "@/lib/db";

// 지금은 시스템 알림 하나만 대상을 고른다. 개선 제안 접수는 관리자 전원이 받는다(디렉터 확인).
// 나중에 다른 알림도 담당자를 나누고 싶으면 여기에 한 줄 추가하고 보내는 쪽에서 부르면 된다.
export const NOTIFY_TOPICS = {
  system: "시스템 점검·오류 알림",
} as const;
export type NotifyTopic = keyof typeof NOTIFY_TOPICS;

const keyOf = (topic: NotifyTopic) => `notifyTargets.${topic}`;

/** 설정에 저장된 수신자 id 목록 (설정이 없으면 null) */
export async function readNotifyTargets(topic: NotifyTopic): Promise<string[] | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: keyOf(topic) } });
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export async function saveNotifyTargets(topic: NotifyTopic, userIds: string[]): Promise<void> {
  const value = JSON.stringify([...new Set(userIds)]);
  await prisma.appSetting.upsert({
    where: { key: keyOf(topic) },
    create: { key: keyOf(topic), value },
    update: { value },
  });
}

/**
 * 실제로 보낼 대상. **비어 있으면 관리자 전원으로 되돌린다.**
 *
 * 아무도 안 받는 상태를 허용하면 알림이 조용히 사라진다 — 9/2 에 로그가 조용해서
 * 사고를 못 알아챈 것과 같은 실패다. 지정한 사람이 전부 퇴사.비활성이어도 마찬가지다.
 */
// 마지막으로 성공한 수신자 목록. **DB 장애 알림을 보내려면 DB 를 읽어야 하는** 모순을 푼다 —
// 조회가 실패하면 예외가 밖으로 나가 헬스체크가 통째로 죽고, 정작 "DB 응답 실패" 알림이 못 나간다.
const lastKnown = new Map<NotifyTopic, string[]>();

export async function getNotifyRecipients(topic: NotifyTopic): Promise<string[]> {
  try {
    const admins = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });
    const all = admins.map((a) => a.id);
    const picked = await readNotifyTargets(topic);
    const result = !picked || picked.length === 0
      ? all
      : (picked.filter((id) => all.includes(id)).length ? picked.filter((id) => all.includes(id)) : all);
    if (result.length) lastKnown.set(topic, result);
    return result;
  } catch {
    // DB 를 못 읽는 상황 자체가 알려야 할 사고다. 마지막으로 알던 사람에게라도 보낸다.
    return lastKnown.get(topic) ?? [];
  }
}
