"use client";

// 큐브티워크 미확인 메시지 수 배지 — 사이드바 "큐브티워크" 버튼용 (카톡식).
// 앱 메신저 탭 배지와 같은 API(/api/work/unread)를 사용해 기준이 동일하다.
// 30초 폴링 + 창 포커스 시 즉시 갱신.
import { isSessionExpired } from "@/lib/session-expiry";
import { useEffect, useRef, useState } from "react";

export function WorkUnreadBadge() {
  const [count, setCount] = useState(0);
  const ivRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/work/unread");
        // 세션이 끊기면 멈춘다 (2026-09-04)
        if (isSessionExpired(res)) { clearInterval(ivRef.current); return; }
        if (res.ok && alive) setCount((await res.json()).total || 0);
      } catch { /* 네트워크 오류는 조용히 무시 */ }
    };
    load();
    const iv = setInterval(load, 30000);
    ivRef.current = iv;
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("focus", onFocus); };
  }, []);

  if (count <= 0) return null;
  return (
    <span className="ml-auto bg-red-500 text-white text-[11px] font-bold leading-none rounded-full px-1.5 min-w-[20px] h-5 inline-flex items-center justify-center">
      {count > 99 ? "99+" : count}
    </span>
  );
}
