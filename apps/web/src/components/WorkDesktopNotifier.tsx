"use client";

// 큐브티워크 데스크톱 알림 전역 컴포넌트 — 채팅 페이지가 아니어도(대시보드·출퇴근 등 어느 화면이든)
// 새 메시지 브라우저 알림을 띄운다. 토글은 채팅 사이드바의 종 아이콘(localStorage workDesktopNotify).
// SSE 신호(message + senderId + msgId, 내용 미포함)를 받아 채널 목록을 재조회해 미리보기를 구성한다.
// 탭이 여러 개 열려 있으면 메시지별 Web Lock을 선점한 탭 1개만 알림을 생성한다.
// (여러 탭이 같은 tag로 동시에 생성하면 크롬이 배너 없이 조용히 교체해 알림이 안 보이는 문제 방지)
import { useEffect, useRef } from "react";

type Ch = { id: string; name: string; notify: string; lastMessage: { content: string } | null };
type LockManager = {
  request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) => Promise<void>;
};

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
    try { readEnabled(); } catch { /* localStorage 접근 불가 환경 */ }
    // 채팅 페이지 토글(같은 탭) + 다른 탭 변경 반영
    const onChanged = () => { try { readEnabled(); } catch { /* noop */ } };
    window.addEventListener("workDesktopNotifyChanged", onChanged);
    window.addEventListener("storage", onChanged);

    const show = async (channelId: string) => {
      const res = await fetch("/api/work/channels");
      if (!res.ok) return;
      const chs: Ch[] = (await res.json()).channels || [];
      const ch = chs.find((c) => c.id === channelId);
      if (!ch || ch.notify === "MUTE") return;
      const preview = ch.lastMessage?.content?.trim() || "새 메시지가 도착했습니다";
      if (ch.notify === "MENTION" && !preview.includes(`@${myNameRef.current}`)) return;
      // 발신 구분 (#137): DM 제목은 상대 이름(봇이면 "큐브티 봇"/"큐브티 인사봇")이 그대로 표시된다.
      // 인사봇(전자계약 전담)은 제목 앞에 🖋 를 붙여 일반 봇·사람 알림과 한눈에 구분되게 한다.
      const title = ch.name === "큐브티 인사봇" ? `🖋 ${ch.name}` : ch.name;
      // renotify: 같은 방의 연속 메시지(같은 tag)로 교체될 때도 배너·소리를 다시 울린다
      const n = new Notification(title, {
        body: preview.slice(0, 120),
        icon: "/favicon.ico",
        tag: `work-${channelId}`,
        renotify: true,
      } as NotificationOptions & { renotify: boolean });
      n.onclick = () => {
        window.focus();
        if (window.location.pathname === "/work/chat") {
          window.dispatchEvent(new CustomEvent("workOpenChannel", { detail: channelId }));
        } else {
          window.location.href = `/work/chat?channel=${channelId}`;
        }
        n.close();
      };
    };

    const notify = async (channelId: string, senderId?: string, msgId?: string) => {
      if (!enabledRef.current || muteAllRef.current) return;
      if (senderId && senderId === myIdRef.current) return;
      // 채팅 화면에서 그 방을 보고 있으면 생략 (채팅 페이지가 전역 변수로 노출)
      const activeCh = (window as unknown as { __workActiveChannelId?: string | null }).__workActiveChannelId;
      if (!document.hidden && document.hasFocus() && activeCh === channelId) return;
      try {
        // 다른 탭의 채팅 화면이 그 방을 보고 있어도 생략 — 채팅 페이지가 "채널ID|타임스탬프"를
        // 10초마다 갱신(하트비트)하므로, 25초 내 갱신된 값만 유효(탭 강제종료 잔류값 자가 소멸)
        const viewing = localStorage.getItem("workViewingChannel");
        if (viewing) {
          const [vid, vts] = viewing.split("|");
          if (vid === channelId && Date.now() - Number(vts) < 25000) return;
        }
        const locks = (navigator as { locks?: LockManager }).locks;
        if (locks?.request && msgId) {
          // 메시지별 락 선점 — 탭이 여러 개여도 이 메시지의 알림은 한 탭만 만든다.
          // 3초 유지는 이벤트를 늦게 받은 탭의 중복 생성 억제 창.
          await locks.request(`qubetee-work-msg-${msgId}`, { ifAvailable: true }, async (lock) => {
            if (!lock) return; // 다른 탭이 이미 처리
            await show(channelId);
            await new Promise((r) => setTimeout(r, 3000));
          });
        } else {
          await show(channelId);
        }
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
            if (e.type === "message") notify(e.channelId, e.senderId, e.msgId);
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
