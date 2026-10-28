"use client";

// 메뉴 빨간 불·건수(/api/nav-counts) — 상단 바·사이드바·휴대폰 서랍이 한 번 받은 값을 함께 쓴다(요청은 하나).
// 1분마다·창으로 돌아올 때 다시 받는다. 로그인이 끊기면 멈춘다.
import { useSyncExternalStore } from "react";
import { isSessionExpired } from "@/lib/session-expiry";

export type NavCounts = Partial<Record<"approvals" | "leaveInbox" | "contractSign" | "mySign" | "contractsOpen" | "leavePending" | "templates", number>>;
/** 빨간 숫자(내가 처리할 것·안 끝난 것) — 나머지(양식 수 등)는 회색 */
export const RED_KEYS = new Set(["approvals", "leaveInbox", "contractSign", "mySign", "contractsOpen", "leavePending"]);

let state: NavCounts = {};
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let stopped = false;
let lastAt = 0;
let gen = 0;   // 로그아웃(reset)마다 올린다 — 그 전에 출발한 응답이 앞사람 숫자를 되살리지 않게

/** 로그아웃 때 — 같은 탭에서 다음 사람이 로그인해도 앞사람 숫자가 보이지 않게 */
export function resetNavCounts() {
  state = {};
  lastAt = 0;
  stopped = false;
  gen++;
  subs.forEach((f) => f());
}

async function load() {
  if (stopped) return;
  // 숨긴 탭은 묻지 않는다(서버 부담 — 2코어). 돌아오면 focus 로 다시 받는다
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  lastAt = Date.now();
  const my = gen;
  try {
    const r = await fetch("/api/nav-counts", { cache: "no-store" });
    if (isSessionExpired(r)) { stopped = true; if (timer) clearInterval(timer); return; }
    if (!r.ok) return;
    const next = await r.json();
    if (my !== gen) return;
    state = next;
    subs.forEach((f) => f());
  } catch { /* 네트워크 오류는 다음 차례에 */ }
}
const onFocus = () => { if (Date.now() - lastAt > 15_000) void load(); };
// 뒤에서 열린 탭은 처음 받기를 건너뛴다 — 화면에 보이게 되는 순간 바로 받는다(focus 가 안 오는 경우도 있어서)
const onVisible = () => { if (document.visibilityState === "visible" && Date.now() - lastAt > 15_000) void load(); };

function subscribe(f: () => void) {
  subs.add(f);
  if (subs.size === 1) {
    void load();
    timer = setInterval(load, 60_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
  }
  return () => {
    subs.delete(f);
    if (subs.size === 0) { if (timer) clearInterval(timer); timer = null; window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onVisible); }   // 값은 남긴다 — 모드를 바꿀 때 빨간 점이 깜박이지 않게(로그아웃은 resetNavCounts 가 비운다)
  };
}
const EMPTY: NavCounts = {};
export function useNavCounts(): NavCounts {
  return useSyncExternalStore(subscribe, () => state, () => EMPTY);
}

/** 메뉴 옆 숫자 — 0 이면 안 그린다 */
export function CountBadge({ n, red }: { n?: number; red?: boolean }) {
  if (!n || n <= 0) return null;
  return (
    // 처리할 건수는 인디고(빨강은 지각 · 결근 · 누락 같은 문제에만 — 2026-10-28 이예지 디자인 ①). 이름 red 는 「처리할 건」이라는 뜻으로 남겨 둔다
    <span className={red ? "ml-auto min-w-[20px] rounded-full bg-[#eef2ff] px-1.5 text-center text-xs font-bold leading-5 text-[#4f46e5]" : "ml-auto min-w-[20px] rounded-full px-1.5 text-center text-xs leading-5 text-gray-400"}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
