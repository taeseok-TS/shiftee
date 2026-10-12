"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

/**
 * 내 화면 설정 훅(2026-10-12 QA #73) — 서버(`/api/me/prefs`)에 **사람마다** 저장.
 *  · 서버 렌더·첫 화면은 기본값, 서버 응답이 오면 그 값. 브라우저에 사본을 두지 않는다 — 공용 PC 에서 다음 사람에게
 *    앞사람 설정이 보이거나 앞사람 설정이 그 사람 계정에 저장되던 것(10/12 검증 1). 화면을 열 때마다 서버를 한 번 읽고,
 *    응답의 userId 가 바뀌었으면(로그아웃 뒤 다른 사람 로그인) 저장소를 그 사람 것으로 갈아 끼운다.
 *  · 바꾸면 화면은 즉시, 서버 저장은 600ms 뒤 한 번(연타해도 한 번만). 바꾼 뒤 도착한 옛 GET 응답은 버린다(검증 2).
 *  · 같은 키를 쓰는 화면이 여럿이어도(본부·원장 근무일정) 한 저장소를 본다.
 *  · `clean(raw)` 이 모르는 값·낡은 모양을 기본값으로 바꿔 준다.
 *  · 두 탭·두 PC 에서 동시에 바꾸면 나중 저장이 이긴다(설정값이라 감수).
 */
type Store<T> = { value: T; userId: string | null; version: number; subs: Set<() => void>; fetching: Promise<void> | null };
const stores = new Map<string, Store<unknown>>();

function getStore<T>(key: string, defaults: T): Store<T> {
  let s = stores.get(key) as Store<T> | undefined;
  if (!s) { s = { value: defaults, userId: null, version: 0, subs: new Set(), fetching: null }; stores.set(key, s as Store<unknown>); }
  return s;
}
function emit(s: Store<unknown>) { s.subs.forEach((cb) => cb()); }

export function useUserPrefs<T extends object>(key: string, defaults: T, clean: (raw: unknown) => T): [T, (patch: Partial<T>) => void, boolean] {
  const defaultsRef = useRef(defaults);
  const cleanRef = useRef(clean);
  const subscribe = (cb: () => void) => { const s = getStore(key, defaultsRef.current); s.subs.add(cb); return () => { s.subs.delete(cb); }; };
  const value = useSyncExternalStore(subscribe, () => getStore(key, defaultsRef.current).value, () => defaultsRef.current);
  const loaded = useSyncExternalStore(subscribe, () => getStore(key, defaultsRef.current).userId !== null, () => false);

  // 화면을 열 때마다 서버 값을 읽는다(동시에 여럿이면 한 번). 사람이 바뀌었으면 그 사람 값으로
  useEffect(() => {
    const s = getStore(key, defaultsRef.current);
    if (s.fetching) return;
    const sentAt = s.version;
    s.fetching = fetch("/api/me/prefs")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || typeof d.userId !== "string") return;
        const changedUser = s.userId !== null && s.userId !== d.userId;
        if (!changedUser && s.version !== sentAt) return;   // 읽는 동안 사용자가 바꿨으면 옛 서버값으로 되돌리지 않는다
        const raw = d.prefs && typeof d.prefs === "object" ? (d.prefs as Record<string, unknown>)[key] : undefined;
        s.value = raw === undefined ? defaultsRef.current : cleanRef.current(raw);   // 서버에 없으면 **기본값**(남의 값을 믿지 않는다)
        s.userId = d.userId;
        emit(s as Store<unknown>);
      })
      .catch(() => { /* 서버 못 읽으면 기본값으로 간다 */ })
      .finally(() => { s.fetching = null; });
  }, [key]);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const update = (patch: Partial<T>) => {
    const s = getStore(key, defaultsRef.current);
    s.value = cleanRef.current({ ...s.value, ...patch });
    s.version += 1;
    emit(s as Store<unknown>);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fetch("/api/me/prefs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: s.value }) }).catch(() => {});
    }, 600);
  };
  return [value, update, loaded];
}
