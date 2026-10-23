// 원장 알림 설정 — 서버에서 읽는 곳(2026-10-23). 뜻·저장 형식은 lib/notify-prefs-core 머리 주석.
//
// ⚠ 실패하면 **보내는 쪽으로** 둔다(fail-open). 설정을 못 읽어 결재 요청이 조용히 사라지면
//   결재가 멈춘다 — 알림이 한 번 더 가는 편이 낫다.
// ⚠ "server-only" 를 넣지 않는다 — 봇 스케줄러·워커가 이 모듈을 거쳐 부른다(워커 server-only 함정).
import { prisma } from "@/lib/db";
import { DEFAULT_MANAGER_NOTIFY, parseManagerNotify, type ManagerNotifyPrefs } from "@/lib/notify-prefs-core";

const prefKey = (userId: string) => `userpref:${userId}`;

/** 여러 사람의 원장 알림 설정을 한 번에 읽는다. 저장이 없는 사람은 모두 켬. 읽기 실패도 모두 켬. */
export async function readManagerNotifyPrefs(userIds: string[]): Promise<Map<string, ManagerNotifyPrefs>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const out = new Map<string, ManagerNotifyPrefs>(ids.map((id) => [id, { ...DEFAULT_MANAGER_NOTIFY }]));
  if (!ids.length) return out;
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { in: ids.map(prefKey) } }, select: { key: true, value: true } });
    for (const r of rows) {
      const id = r.key.slice("userpref:".length);
      let v: unknown = null;
      try { v = JSON.parse(r.value); } catch { v = null; }
      const notify = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>).notify : undefined;
      out.set(id, parseManagerNotify(notify));
    }
  } catch (e) {
    console.error("[notify-prefs] 원장 알림 설정 조회 오류(모두 켬으로 봄):", e);
  }
  return out;
}

/** 본부 「결재 알림 강제」가 켜져 있는가 — 켜져 있으면 결재 요청 알림·메일을 끈 원장에게도 보낸다. 읽기 실패면 강제로 본다(보내는 쪽). */
export async function isApprovalNotifyForced(): Promise<boolean> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: "forceApprovalNotify" } });
    return row?.value === "true";
  } catch (e) {
    console.error("[notify-prefs] 결재 알림 강제 조회 오류(강제로 봄):", e);
    return true;
  }
}

export type ApprovalChannel = "dm" | "email";

/**
 * 결재 요청 알림을 **끈 원장**의 id 모음. 여기 든 사람에게는 그 채널(봇 DM·푸시 / 메일)로 결재 요청을 보내지 않는다.
 *  · 원장(MANAGER)만 해당 — 직원·관리자는 늘 빈 결과(종전대로 받음)
 *  · 본부 강제가 켜져 있으면 빈 결과
 *  · 조회 실패도 빈 결과(보내는 쪽)
 */
export async function approvalRequestMutedIds(userIds: (string | null | undefined)[], channel: ApprovalChannel): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter((x): x is string => !!x))];
  const muted = new Set<string>();
  if (!ids.length) return muted;
  try {
    if (await isApprovalNotifyForced()) return muted;
    const managers = await prisma.user.findMany({ where: { id: { in: ids }, role: "MANAGER" }, select: { id: true } });
    if (!managers.length) return muted;
    const prefs = await readManagerNotifyPrefs(managers.map((m) => m.id));
    for (const m of managers) {
      const p = prefs.get(m.id);
      if (!p) continue;
      if (channel === "dm" ? !p.approvalRequest : !p.approvalEmail) muted.add(m.id);
    }
  } catch (e) {
    console.error("[notify-prefs] 결재 요청 알림 설정 판정 오류(보냄):", e);
    return new Set();
  }
  return muted;
}

/** 한 사람에게 결재 요청을 그 채널로 보내도 되는가(원장이 껐고 본부 강제가 아니면 false). */
export async function wantsApprovalRequest(userId: string | null | undefined, channel: ApprovalChannel): Promise<boolean> {
  if (!userId) return true;
  return !(await approvalRequestMutedIds([userId], channel)).has(userId);
}

/** 지점 직원 변동 알림을 켠 사람만 남긴다(원장 설정 staffChange — 저장이 없으면 켬). */
export async function staffChangeOptedIn(userIds: string[]): Promise<string[]> {
  const prefs = await readManagerNotifyPrefs(userIds);
  return userIds.filter((id) => prefs.get(id)?.staffChange !== false);
}
