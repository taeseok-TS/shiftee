"use client";

// 입학정보실(진학입시EX) 열기 — 2026-10-19 디렉터 결정(큐브티 직원 전체).
// 1) 누른 그 순간(동기) 빈 새 탭을 먼저 연다 — fetch 뒤에 열면 브라우저가 팝업으로 보고 막는다.
// 2) 서버가 만든 60초짜리 입장 주소를 받아 그 탭을 그리로 보낸다. 입장권은 변수에만 잠깐 두고 저장소엔 두지 않는다.
// 3) 실패면 빈 탭을 닫고 안내한다.
import { useEffect, useState } from "react";

let busy = false;

// 단추를 보일지 — 서버(INFO_PASS_ENABLED)에 한 번만 묻고 사이드바·폰 상단 바가 함께 쓴다(2026-10-19 「잠깐 숨겨놔」)
let enabledPromise: Promise<boolean> | null = null;
export function useJinhakInfoEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    enabledPromise ??= fetch("/api/integrations/jinhak-info/status", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((d) => d?.enabled === true)
      .catch(() => false);
    let alive = true;
    void enabledPromise.then((v) => { if (alive) setEnabled(v); });
    return () => { alive = false; };
  }, []);
  return enabled;
}

export async function openJinhakInfo(): Promise<void> {
  if (busy) return; // 두 번 눌러 탭이 두 개 열리지 않게
  busy = true;
  const w = window.open("", "_blank");
  if (w) {
    try { w.opener = null; } catch { /* 일부 브라우저는 막는다 — 그래도 진행 */ }
    try { w.document.title = "입학정보실 여는 중…"; w.document.body.innerHTML = '<p style="font-family:sans-serif;padding:24px;color:#555">입학정보실로 이동하는 중입니다…</p>'; } catch { /* 빈 탭 문구는 꾸밈일 뿐 */ }
  }
  try {
    const res = await fetch("/api/integrations/jinhak-info/pass", { method: "POST", cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || typeof data?.url !== "string") {
      w?.close();
      if (res.status === 401) { window.location.href = "/login"; return; }
      window.alert(data?.error || "입학정보실을 열지 못했습니다. 잠시 뒤 다시 눌러 주세요.");
      return;
    }
    if (w && !w.closed) w.location.replace(data.url);
    else window.location.assign(data.url); // 새 탭이 막혔거나 닫혔으면 이 탭에서 연다(입장권은 60초라 미룰 수 없다)
  } catch {
    w?.close();
    window.alert("입학정보실을 열지 못했습니다. 인터넷 연결을 확인하고 다시 눌러 주세요.");
  } finally {
    busy = false;
  }
}
