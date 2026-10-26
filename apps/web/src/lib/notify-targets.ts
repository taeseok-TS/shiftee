// 관리자 알림 수신자 (2026-09-03 · 종류 확장 2026-10-26)
//
// 종전에는 관리자 전원(7명)에게 뿌렸다. 시스템 오류는 담당자만 보면 되고, 나머지에게는
// 소음이다. 담당자는 바뀌므로 **코드가 아니라 설정에서** 고를 수 있어야 한다.
//
// 저장은 AppSetting(key/value)에 JSON 배열로 한다 — 결재 알림 정책이 이미 쓰는 방식이라
// 스키마 변경도, 운영 DB 마이그레이션도 필요 없다(스키마 드리프트 사고를 여러 번 냈다).
//
// 2026-10-26 디렉터 지시 「관리자에게 오는 봇 알림을 상황에 따라 받는 담당자를 설정하고 싶다」—
// 시스템 알림 하나만 고르던 것을 **봇이 관리자에게 보내는 모든 종류**로 넓혔다.
// 보내는 쪽은 전부 getNotifyRecipients(<종류>) 를 부른다. 관리자 전원 findMany 를 직접 쓰지 말 것.
import { prisma } from "@/lib/db";
import { kstTodayMidnight } from "@/lib/resign";

/**
 * 알림 종류 — 키는 AppSetting 키(`notifyTargets.<key>`)에 들어가므로 바꾸면 저장된 지정이 사라진다.
 * label 은 화면 줄 이름, hint 는 그 종류가 어떤 문구를 보내는지 한 줄 설명(관리자 화면 > 봇 설정).
 *
 * 수신자 설정 대상에서 **뺀 것**: 회사 연동 키 회수 알림(lib/api-key notifyOrgKeysRevoked) —
 * 연동 키 화면이 최고 관리자 전용이라 열 수 없는 사람에게 보내지 않는다(2026-10-23 ■0-3). 고르게 두면
 * 화면을 못 여는 사람에게 갈 수 있어 그대로 최고 관리자 고정이다.
 */
export const NOTIFY_TOPICS = {
  system: { label: "시스템 점검·오류 알림", hint: "서버 오류·디스크·실패 응답·일일 점검 보고, 지점 추가·변경(위치 검사 안내)" },
  approval: { label: "본부 차례 결재 요청", hint: "휴가·근무 변경·휴가 취소·출퇴근 수정·기기 변경이 본부 결재 차례가 되면 「결재 요청이 도착했습니다」" },
  progress: { label: "요청 진행 알림", hint: "신청·원장 승인·반려·취소·기한 만료를 「[진행 알림]」으로 — 결재 차례가 아니어도 받습니다" },
  managerChange: { label: "원장 근무일정 변경", hint: "원장이 본인(또는 다른 원장)의 근무일정을 직접 바꾸면 알립니다" },
  contract: { label: "전자계약 서명 기한 만료", hint: "기한이 지나 만료된 계약을 하루치 한 통으로 — 재발송 안내 포함" },
  suggestion: { label: "개선 제안 접수", hint: "직원이 개선 제안을 올리면 「[접수] #번호 제목」" },
  roster: { label: "인사명부 연동 결과", hint: "매일 아침 인사명부 가져오기 실패 또는 확인 대기 건수" },
  submission: { label: "자료 제출 현황", hint: "마감 지난 요청의 미제출 명단, 18시 오늘 제출 요약" },
  integration: { label: "연동 키 이상 사용", hint: "개인 연동 키가 이상 사용으로 멈추면 알립니다 (회사 연동 키 회수는 최고 관리자 고정)" },
} as const;
export type NotifyTopic = keyof typeof NOTIFY_TOPICS;
export const NOTIFY_TOPIC_KEYS = Object.keys(NOTIFY_TOPICS) as NotifyTopic[];
export const isNotifyTopic = (v: unknown): v is NotifyTopic => typeof v === "string" && (NOTIFY_TOPIC_KEYS as string[]).includes(v);   // `in` 은 constructor 같은 프로토타입 키도 통과시킨다(10/26 검증 1)
/** 화면·API 에 내려줄 목록 꼴 */
export const notifyTopicList = () => NOTIFY_TOPIC_KEYS.map((key) => ({ key, ...NOTIFY_TOPICS[key] }));

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

/** 모든 종류의 저장값을 한 번에 (화면용) */
export async function readAllNotifyTargets(): Promise<Record<NotifyTopic, string[] | null>> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: NOTIFY_TOPIC_KEYS.map(keyOf) } } });
  const out = {} as Record<NotifyTopic, string[] | null>;
  for (const t of NOTIFY_TOPIC_KEYS) {
    const row = rows.find((r) => r.key === keyOf(t));
    let v: string[] | null = null;
    if (row?.value) {
      try {
        const p = JSON.parse(row.value);
        v = Array.isArray(p) ? p.filter((x) => typeof x === "string") : null;
      } catch { v = null; }
    }
    out[t] = v;
  }
  return out;
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

/** 재직 중인 활성 관리자 조건 — 삭제·퇴사일 지난 계정은 뺀다. 수신자 계산과 설정 화면(목록·저장 검증)이 같은 조건을 쓴다(10/26 검증 2) */
export const activeAdminWhere = () => ({ role: "ADMIN" as const, isActive: true, deletedAt: null, AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] }] });
/** 재직 중인 활성 관리자 전원 id */
export async function activeAdminIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: activeAdminWhere(),
    select: { id: true },
  });
  return admins.map((a) => a.id);
}

export async function getNotifyRecipients(topic: NotifyTopic): Promise<string[]> {
  try {
    const all = await activeAdminIds();
    const picked = await readNotifyTargets(topic);
    const result = !picked || picked.length === 0
      ? all
      : (picked.filter((id) => all.includes(id)).length ? picked.filter((id) => all.includes(id)) : all);
    if (result.length) lastKnown.set(topic, result);
    return result;
  } catch (e) {
    // DB 를 못 읽는 상황 자체가 알려야 할 사고다. 마지막으로 알던 사람에게라도 보내고, 로그는 남긴다(10/26 검증 3)
    console.error("[notify-targets] 수신자 조회 실패:", topic, e instanceof Error ? e.message : e);
    return lastKnown.get(topic) ?? [];
  }
}
