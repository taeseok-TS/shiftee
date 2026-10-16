// 「개발자 영역」 숨김 계정 (2026-10-17 디렉터 결정)
//
// 메인 관리자(User.isSuperAdmin = true) 계정은 개발·운영용이라 직원·원장·서브 관리자에게
// **사람 목록·검색·멤버 명단**에서 보이지 않게 한다. 보는 사람(기본: 김태석 본부장)만 그대로 본다.
//
// ⚠ 이미 남은 기록은 건드리지 않는다(디렉터 결정) — 보낸 메시지의 보낸 사람 이름, 결재 이력의 승인자,
//   변경 로그 행위자, 계약 PDF, 출퇴근 수정 이력, 이미 있는 DM 방 상대 이름은 그대로다.
// ⚠ 보이는 목록만 거른다 — 결재 처리 대상 계산·권한 판정·알림 발송 대상에는 쓰지 말 것
//   (숨김 계정도 알림은 계속 받고, 권한도 그대로다).
//
// 스키마는 바꾸지 않는다. 보는 사람 목록은 AppSetting `hiddenAccounts.viewers`(JSON 배열 또는 쉼표 구분 이메일)가
// 있으면 그것, 없으면 기본값. lib/notify-targets.ts 와 같은 AppSetting 관례다.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const VIEWERS_KEY = "hiddenAccounts.viewers";
const DEFAULT_VIEWERS = ["taeseok_kim@nexcubecorp.com"];
const TTL_MS = 60_000;
// DB 오류일 때는 실패 결과를 짧게만 기억한다 — 요청마다 재조회·오류 로그가 쏟아지지 않게(검증 지적 2026-10-17)
const FAIL_TTL_MS = 10_000;

type State = { hiddenIds: string[]; viewerIds: string[]; at: number; ttl: number };
let cache: State | null = null;
let inflight: Promise<State> | null = null;

type Viewer = { userId: string } | null | undefined;

function parseViewers(value: string | null | undefined): string[] {
  if (!value?.trim()) return DEFAULT_VIEWERS;
  let list: unknown = null;
  try { list = JSON.parse(value); } catch { list = value.split(","); }
  const arr = Array.isArray(list) ? list : typeof list === "string" ? [list] : [];
  const emails = arr.filter((x): x is string => typeof x === "string").map((x) => x.trim().toLowerCase()).filter(Boolean);
  return emails.length ? emails : DEFAULT_VIEWERS;
}

async function load(): Promise<State> {
  const [row, supers] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: VIEWERS_KEY } }),
    prisma.user.findMany({ where: { isSuperAdmin: true }, select: { id: true, email: true } }),
  ]);
  const viewerEmails = parseViewers(row?.value);
  // 보는 사람은 **DB 계정 id 로만** 판정한다 — 토큰에 박힌 이메일은 발급 뒤 주소가 바뀌어도 그대로라 기준으로 쓰지 않는다.
  // DB 주소 앞뒤 공백도 무시한다(대소문자 무시는 mode insensitive)
  const viewers = await prisma.user.findMany({
    where: { OR: viewerEmails.map((e) => ({ email: { contains: e, mode: "insensitive" as const } })) },
    select: { id: true, email: true },
  });
  const viewerIds = viewers.filter((v) => viewerEmails.includes(v.email.trim().toLowerCase())).map((v) => v.id);
  // 보는 사람 본인이 메인 관리자여도 숨김 대상이 아니다
  const hiddenIds = supers.filter((u) => !viewerIds.includes(u.id)).map((u) => u.id);
  return { hiddenIds, viewerIds, at: Date.now(), ttl: TTL_MS };
}

async function state(): Promise<State> {
  if (cache && Date.now() - cache.at < cache.ttl) return cache;
  if (!inflight) {
    inflight = load()
      .then((s) => (cache = s))
      .catch((e) => {
        // DB 가 흔들려도 화면이 죽지 않게 — 마지막으로 알던 값, 그것도 없으면 아무도 숨기지 않는다.
        // 그 결과를 10초 동안 기억해 둔다(다음 요청이 곧바로 다시 DB 를 두드리지 않게)
        console.error("[hidden-accounts] 조회 실패:", e);
        const prev = cache;
        return (cache = { hiddenIds: prev?.hiddenIds ?? [], viewerIds: prev?.viewerIds ?? [], at: Date.now(), ttl: FAIL_TTL_MS });
      })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

/** 숨김 계정 id 전체(보는 사람 예외 없음) — 봇 브리핑처럼 전사 공개 화면에서 쓴다 */
export async function getHiddenUserIds(): Promise<string[]> {
  return (await state()).hiddenIds;
}

/** 보는 사람(개발자 영역 열람자) 계정 id — 퇴사자 방 넘겨받을 사람 1순위 등 */
export async function getHiddenViewerIds(): Promise<string[]> {
  return (await state()).viewerIds;
}

/** 이 세션이 숨김 계정을 볼 수 있는가 — 보는 사람 이메일로 찾은 DB 계정 id 와 같을 때만 */
export async function canSeeHidden(session: Viewer): Promise<boolean> {
  if (!session) return false;
  return (await state()).viewerIds.includes(session.userId);
}

/**
 * 이 세션에게 감출 id 목록. 보는 사람이면 빈 배열.
 * 숨김 계정 본인은 자기 자신은 본다(자기 행이 사라지면 시스템 설정 관리자 목록 등이 이상해진다).
 */
export async function hiddenIdsFor(session: Viewer): Promise<string[]> {
  if (await canSeeHidden(session)) return [];
  const ids = await getHiddenUserIds();
  return session ? ids.filter((id) => id !== session.userId) : ids;
}

/** Prisma User where 조각 — 감출 게 없으면 빈 객체. 이미 `id` 조건이 있는 곳은 AND 로 합칠 것 */
export async function hiddenWhere(session: Viewer): Promise<Prisma.UserWhereInput> {
  const ids = await hiddenIdsFor(session);
  return ids.length ? { id: { notIn: ids } } : {};
}

/** 설정을 바꾼 직후 바로 반영하고 싶을 때 */
export function clearHiddenAccountsCache(): void {
  cache = null;
}
