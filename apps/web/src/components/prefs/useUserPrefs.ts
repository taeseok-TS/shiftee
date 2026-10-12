"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

/**
 * 내 화면 설정 훅(2026-10-12 QA #73) — 서버(`/api/me/prefs`)에 **사람마다** 저장.
 *  · 서버 렌더·첫 화면은 기본값, 서버 응답이 오면 그 값. 브라우저에 사본을 두지 않는다 — 공용 PC 에서 다음 사람에게
 *    앞사람 설정이 보이거나 앞사람 설정이 그 사람 계정에 저장되던 것(10/12 검증 1).
 *  · 화면을 열 때마다 서버를 한 번 읽고(동시 요청은 하나), 응답의 userId 가 저장소의 것과 다르면(로그아웃 뒤 다른 사람 로그인)
 *    그 사람 값으로 갈아 끼우고 그 사이 쌓인 변경·예약 저장은 버린다. 로그아웃 핸들러는 resetUserPrefs() 로 저장소를 비운다.
 *  · 바꾸면 화면은 즉시. 서버 읽기가 끝나기 전의 변경은 `pending` 에 모아 두었다가 **서버값 위에 병합**한다(옛 응답을 통째로 버리면
 *    다른 PC 에서 저장한 설정이 기본값으로 덮였다 — 10/12 재검증 1·2). 저장(PUT)은 서버 읽기가 성공한 뒤에만, 600ms 묶어서 한 번.
 *  · 같은 키를 쓰는 화면이 여럿이어도(본부·원장 근무일정) 한 저장소를 본다. `clean(raw)` 이 모르는 값·낡은 모양을 기본값으로.
 *  · 두 탭·두 PC 에서 동시에 바꾸면 나중 저장이 이긴다(설정값이라 감수).
 */
type Store<T> = {
  value: T; userId: string | null; pending: Partial<T> | null; version: number;   // version: 바꿀 때마다 +1 — 옛 GET 응답이 새 값을 덮지 않게
  saveTimer: ReturnType<typeof setTimeout> | null; subs: Set<() => void>; fetching: Promise<void> | null; failures: number;
};
const stores = new Map<string, Store<unknown>>();

function getStore<T>(key: string, defaults: T): Store<T> {
  let s = stores.get(key) as Store<T> | undefined;
  if (!s) { s = { value: defaults, userId: null, pending: null, version: 0, saveTimer: null, subs: new Set(), fetching: null, failures: 0 }; stores.set(key, s as Store<unknown>); }
  return s;
}
function emit(s: Store<unknown>) { s.subs.forEach((cb) => cb()); }

/** 저장소 전체 비우기 — 로그아웃 때. 예약된 저장도 취소한다(다음 사람 계정에 앞사람 값이 저장되지 않게) */
export function resetUserPrefs(): void {
  for (const s of stores.values()) {
    if (s.saveTimer) clearTimeout(s.saveTimer);
    s.saveTimer = null; s.pending = null; s.userId = null;
  }
  stores.clear();
}

function scheduleSave<T>(key: string, s: Store<T>) {
  if (s.userId === null) return;   // 서버 읽기 전엔 보내지 않는다 — 기본값으로 남의 설정을 덮지 않게
  if (s.saveTimer) clearTimeout(s.saveTimer);
  s.saveTimer = setTimeout(() => {
    s.saveTimer = null;
    const sent = s.pending;
    s.pending = null;
    // 저장이 **성공한 뒤**에 비운다 — 실패하면 되살려 다음 변경과 함께 다시 보낸다(10/12 3차 검증 1)
    fetch("/api/me/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: s.value }) })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); s.failures = 0; })
      .catch(() => {
        // 실패하면 되살리되 자동 재시도는 2번까지 — 그 뒤엔 다음 변경 때 함께 보낸다(600ms 마다 두드리지 않게)
        if (sent) s.pending = { ...sent, ...(s.pending ?? {}) };
        s.failures += 1;
        if (s.failures <= 2 && !s.saveTimer) scheduleSave(key, s);
      });
  }, 600);
}

export function useUserPrefs<T extends object>(key: string, defaults: T, clean: (raw: unknown) => T): [T, (patch: Partial<T>) => void, boolean] {
  const defaultsRef = useRef(defaults);
  const cleanRef = useRef(clean);
  const subscribe = useCallback((cb: () => void) => { const s = getStore(key, defaultsRef.current); s.subs.add(cb); return () => { s.subs.delete(cb); }; }, [key]);
  const value = useSyncExternalStore(subscribe, () => getStore(key, defaultsRef.current).value, () => defaultsRef.current);
  const loaded = useSyncExternalStore(subscribe, () => getStore(key, defaultsRef.current).userId !== null, () => false);

  useEffect(() => {
    const s = getStore(key, defaultsRef.current);
    if (s.fetching) return;
    const sentAt = s.version;
    s.fetching = fetch("/api/me/prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || typeof d.userId !== "string") return;
        const raw = d.prefs && typeof d.prefs === "object" ? (d.prefs as Record<string, unknown>)[key] : undefined;
        const server = raw === undefined ? defaultsRef.current : cleanRef.current(raw);   // 서버에 없으면 기본값(남의 값을 믿지 않는다)
        if (s.userId !== null && s.userId !== d.userId) {
          // 사람이 바뀌었다 — 앞사람 값·미저장 변경·예약 저장을 모두 버린다
          if (s.saveTimer) clearTimeout(s.saveTimer);
          s.saveTimer = null; s.pending = null;
          s.value = server;
        } else if (s.pending) {
          s.value = cleanRef.current({ ...server, ...s.pending });   // 읽는 동안 바꾼 것은 서버값 위에 병합
        } else if (s.version === sentAt || s.userId === null) {
          s.value = server;   // 읽는 동안 아무것도 안 바꿨거나(또는 첫 읽기) 서버값 그대로
        }
        // 그 밖(읽는 동안 바꿔서 이미 저장까지 끝남)은 화면 값을 지킨다 — 느린 GET 이 방금 저장한 값을 되돌리던 것(3차 검증 1)
        s.userId = d.userId;
        emit(s as Store<unknown>);
        if (s.pending) scheduleSave(key, s);   // 읽기 전에 바꾼 것이 있으면 이제 저장
      })
      .catch(() => { /* 서버 못 읽으면 기본값으로 보고, 저장은 보류(userId 없음) */ })
      .finally(() => { s.fetching = null; });
  }, [key]);

  const update = (patch: Partial<T>) => {
    const s = getStore(key, defaultsRef.current);
    s.value = cleanRef.current({ ...s.value, ...patch });
    s.pending = { ...(s.pending ?? {}), ...patch };
    s.version += 1;
    emit(s as Store<unknown>);
    scheduleSave(key, s);
  };
  return [value, update, loaded];
}
