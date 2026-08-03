"use client";

// 큐브티워크 데스크톱 알림 전역 컴포넌트 — 채팅 페이지가 아니어도(대시보드·출퇴근 등 어느 화면이든)
// 새 메시지 브라우저 알림을 띄운다. 토글은 채팅 사이드바의 종 아이콘(localStorage workDesktopNotify).
// SSE 신호(message + senderId, 내용 미포함)를 받아 채널 목록을 재조회해 미리보기를 구성한다.
import { useEffect, useRef } from "react";

type Ch = { id: string; name: string; notify: string; lastMessage: { content: string } | null };

export default function WorkDesktopNotifier() {
  const enabledRef = useRef(false);
  const myIdRef = useRef("");
  const myNameRef = useRef("");
  const muteAllRef = useRef(false);

  useEffect(() => {
    let es: EventSource | null = null;
    let alive = true;

    const readEnabled = () => {
      enabledRef.current =
        typeof Notification !== "undefined" &&
        Notification.permission === "granted" &&
        localStorage.getItem("workDesktopNotify") === "on";
    };
    readEnabled();
    // 채팅 페이지 토글(같은 탭) + 다른 탭 변경 반영
    const onChanged = () => readEnabled();
    window.addEventListener("workDesktopNotifyChanged", onChanged);
    window.addEventListener("storage", onChanged);

    const notify = async (channelId: string, senderId?: string) => {
      if (!enabledRef.current || muteAllRef.current) return;
      if (senderId && senderId === myIdRef.current) return;
      // 채팅 화면에서 그 방을 보고 있으면 생략 (채팅 페이지가 전역 변수로 노출)
      const activeCh = (window as unknown as { __workActiveChannelId?: string | null }).__workActiveChannelId;
      if (!document.hidden && document.hasFocus() && activeCh === channelId) return;
      try {
        const res = await fetch("/api/work/channels");
        if (!res.ok) return;
        const chs: Ch[] = (await res.json()).channels || [];
        const ch = chs.find((c) => c.id === channelId);
        if (!ch || ch.notify === "MUTE") return;
        const preview = ch.lastMessage?.content?.trim() || "새 메시지가 도착했습니다";
        if (ch.notify === "MENTION" && !preview.includes(`@${myNameRef.current}`)) return;
        const n = new Notification(ch.name, { body: preview.slice(0, 120), icon: "/favicon.ico", tag: `work-${channelId}` });
        n.onclick = () => {
          window.focus();
          if (window.location.pathname === "/work/chat") {
            window.dispatchEvent(new CustomEvent("workOpenChannel", { detail: channelId }));
          } else {
            window.location.href = `/work/chat?channel=${channelId}`;
          }
          n.close();
        };
      } catch { /* 조용히 무시 */ }
    };

    // 로그인 상태에서만 구독 (로그인·공개 페이지에서는 조용히 비활성)
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d?.user) return;
        myIdRef.current = d.user.id || "";
        myNameRef.current = d.user.name || "";
        fetch("/api/me/notify").then((r) => (r.ok ? r.json() : null)).then((n) => {
          if (n) muteAllRef.current = !!n.workMuteAll;
        }).catch(() => {});
        es = new EventSource("/api/work/stream");
        es.onmessage = (ev) => {
          try {
            const e = JSON.parse(ev.data);
            if (e.type === "message") notify(e.channelId, e.senderId);
          } catch { /* noop */ }
        };
      })
      .catch(() => {});

    return () => {
      alive = false;
      es?.close();
      window.removeEventListener("workDesktopNotifyChanged", onChanged);
      window.removeEventListener("storage", onChanged);
    };
  }, []);

  return null;
}
