"use client";

// 큐브티워크 미확인 메시지 수 배지 — 상단 바 「큐브티워크」 버튼용 (카톡식).
// 앱 메신저 탭 배지와 같은 API(/api/work/unread)를 사용해 기준이 동일하다.
// 상단 바·레일 맨 아래 듀리(DuriWorkLink)·휴대폰 서랍이 한 번 받은 값을 함께 쓴다(요청은 하나 — useNavCounts 와 같은 방식,
// /api/work/unread 는 채널 수만큼 DB 를 보는 무거운 조회라 부르는 곳마다 따로 돌리면 2코어 서버에 2~3배가 된다).
// 30초마다·창으로 돌아올 때 다시 받는다. 숨긴 탭은 묻지 않는다. 로그인이 끊기면 멈춘다.
import { isSessionExpired } from "@/lib/session-expiry";
import { useSyncExternalStore } from "react";

let count = 0;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let stopped = false;
let lastAt = 0;
let gen = 0;   // 로그아웃(reset)마다 올린다 — 그 전에 출발한 응답이 앞사람 숫자를 되살리지 않게

/** 로그아웃 때 — 같은 탭에서 다음 사람이 로그인해도 앞사람 숫자가 보이지 않게 */
export function resetWorkUnread() {
  count = 0;
  lastAt = 0;
  stopped = false;
  gen++;
  subs.forEach((f) => f());
}

async function load() {
  if (stopped) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  lastAt = Date.now();
  const my = gen;
  try {
    const res = await fetch("/api/work/unread");
    // 세션이 끊기면 멈춘다 (2026-09-04)
    if (isSessionExpired(res)) { stopped = true; if (timer) clearInterval(timer); return; }
    if (!res.ok) return;
    const total = (await res.json()).total || 0;
    if (my !== gen) return;
    count = total;
    subs.forEach((f) => f());
  } catch { /* 네트워크 오류는 다음 차례에 */ }
}
const onFocus = () => { if (Date.now() - lastAt > 5_000) void load(); };
const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - lastAt > 5_000) void load(); };

function subscribe(f: () => void) {
  subs.add(f);
  if (subs.size === 1) {
    void load();
    timer = setInterval(load, 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    subs.delete(f);
    if (subs.size === 0) { if (timer) clearInterval(timer); timer = null; window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); }
  };
}

/** 안 읽은 수 — 상단 바 버튼과 레일 맨 아래 듀리 「큐브티워크」(DuriWorkLink)가 같이 쓴다 */
export function useWorkUnread(): number {
  return useSyncExternalStore(subscribe, () => count, () => 0);
}

export function WorkUnreadBadge() {
  const n = useWorkUnread();
  if (n <= 0) return null;
  return (
    <span className="ml-auto bg-red-500 text-white text-[11px] font-bold leading-none rounded-full px-1.5 min-w-[20px] h-5 inline-flex items-center justify-center">
      {n > 99 ? "99+" : n}
    </span>
  );
}
