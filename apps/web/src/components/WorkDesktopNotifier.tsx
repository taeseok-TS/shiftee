"use client";

// 큐브티워크 데스크톱 알림 전역 컴포넌트 — 채팅 페이지가 아니어도(대시보드·출퇴근 등 어느 화면이든)
// 새 메시지 브라우저 알림을 띄운다. 토글은 채팅 사이드바의 종 아이콘(localStorage workDesktopNotify).
// 켜짐 판단은 lib/desktop-notify(직원이 직접 끈 경우만 꺼짐). 허용이 풀렸으면 로그인 화면이 아닌 곳에서
// 켜기 안내를 띄워 한 번 클릭으로 되살린다(2026-09-18 "켤 때마다 알림이 꺼진다").
// SSE 신호(message + senderId + msgId, 내용 미포함)를 받아 채널 목록을 재조회해 미리보기를 구성한다.
// 탭이 여러 개 열려 있으면 메시지별 Web Lock을 선점한 탭 1개만 알림을 생성한다.
// (여러 탭이 같은 tag로 동시에 생성하면 크롬이 배너 없이 조용히 교체해 알림이 안 보이는 문제 방지)
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { openWorkStream } from "@/lib/work-stream";
import {
  DESKTOP_NOTIFY_EVENT, enableDesktopNotify, readDesktopNotifyChoice, readDesktopNotifyState,
  saveDesktopNotifyChoice,
} from "@/lib/desktop-notify";

type Ch = { id: string; name: string; notify: string; lastMessage: { content: string } | null };
type LockManager = {
  request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<void>) => Promise<void>;
};

// 켜기 안내 — [나중에]는 이 창을 닫을 때까지만(sessionStorage). 다음에 큐브티를 켜면 다시 묻는다.
const PROMPT_LATER_KEY = "workDesktopNotifyLater";

/**
 * 켜기 안내를 띄울지. PC(마우스) 화면에서만 — 휴대폰 브라우저는 이 방식 알림이 안 되고 앱이 따로 있다.
 *  - ask: 켜려는 상태(직접 끄지 않음)인데 브라우저 허용이 없다 → [알림 켜기] 한 번
 *  - denied: 한 번 켰던 직원인데 브라우저가 막았다 → 푸는 방법 안내(코드로는 못 푼다)
 *    처음부터 막아 둔 직원(선택 기록 없음)에게는 매번 띄우지 않는다.
 */
function promptFor(): "ask" | "denied" | null {
  try {
    if (!window.matchMedia("(pointer: fine)").matches) return null;
    if (sessionStorage.getItem(PROMPT_LATER_KEY) === "1") return null;
  } catch { /* noop */ }
  const st = readDesktopNotifyState();
  if (st === "ask") return "ask";
  if (st === "denied" && readDesktopNotifyChoice() === "on") return "denied";
  return null;
}

// 로그인 전 화면 — 여기로 오면 로그아웃된 것이므로 구독·안내를 멈춘다.
// (로그아웃은 router.push("/login") 이라 루트 레이아웃이 다시 그려지지 않는다 — 검증 notify1 #2)
const SIGNED_OUT_PATHS = ["/login", "/forgot-password", "/reset-password"];
// 로그인한 직원이 열 수도 있는 공개 화면(외부 서명·진위 확인 등) — 알림은 두되 켜기 안내는 띄우지 않는다
const NO_PROMPT_PATHS = [...SIGNED_OUT_PATHS, "/sign/", "/sms-relay/", "/privacy", "/verify/", "/contract-open", "/docs/viewer"];
const under = (path: string, list: string[]) => list.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : p + "/"));

export default function WorkDesktopNotifier() {
  const pathname = usePathname() || "/";
  const [prompt, setPrompt] = useState<"ask" | "denied" | null>(null);
  const [busy, setBusy] = useState(false);
  const loggedInRef = useRef(false);
  const startRef = useRef<(() => void) | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const enabledRef = useRef(false);
  const myIdRef = useRef("");
  const myNameRef = useRef("");
  const muteAllRef = useRef(false);

  useEffect(() => {
    let closeStream: (() => void) | null = null;
    let alive = true;
    let gen = 0; // 로그인 확인 도중 로그아웃되면 늦게 온 응답을 버린다

    // 직원이 직접 끈 경우만 꺼짐 — 브라우저 허용이 있으면 기록이 비어도 켜짐(lib/desktop-notify)
    const readEnabled = () => {
      enabledRef.current = readDesktopNotifyState() === "on";
    };
    readEnabled();
    // 채팅 페이지 토글(같은 탭) + 다른 탭 변경 + 켜기 안내 반영
    const onChanged = () => {
      readEnabled();
      if (loggedInRef.current) setPrompt(promptFor());
    };
    window.addEventListener(DESKTOP_NOTIFY_EVENT, onChanged);
    window.addEventListener("storage", onChanged);
    // 브라우저 사이트 설정에서 허용·차단을 바꾸면 바로 따라간다(지원 브라우저만)
    let permStatus: PermissionStatus | null = null;
    navigator.permissions?.query({ name: "notifications" as PermissionName })
      .then((st) => {
        if (!alive) return;
        permStatus = st;
        // 공용 이벤트로 알려 채팅 종·환경설정 스위치도 함께 따라가게 한다(검증 notify1 #4)
        st.onchange = () => window.dispatchEvent(new Event(DESKTOP_NOTIFY_EVENT));
      })
      .catch(() => {});

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

    // 로그인 상태에서만 구독 (로그인·공개 페이지에서는 조용히 비활성).
    // 로그인 화면에서 로그인하면 화면 이동만 일어나므로, 경로가 바뀔 때 다시 불러 붙인다.
    const start = () => {
      if (loggedInRef.current) return;
      const my = ++gen;
      fetch("/api/auth/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive || my !== gen || !d?.user || loggedInRef.current) return;
          loggedInRef.current = true;
          setPrompt(promptFor());
          myIdRef.current = d.user.id || "";
          myNameRef.current = d.user.name || "";
          muteAllRef.current = false; // 앞서 로그인했던 사람의 '전체 음소거'가 남지 않게
          fetch("/api/me/notify").then((r) => (r.ok ? r.json() : null)).then((n) => {
            if (n) muteAllRef.current = !!n.workMuteAll;
          }).catch(() => {});
          closeStream = openWorkStream((ev) => {
            try {
              const e = JSON.parse(ev.data);
              if (e.type === "message") notify(e.channelId, e.senderId, e.msgId);
            } catch { /* noop */ }
          });
        })
        .catch(() => {});
    };
    const stop = () => {
      gen++;
      loggedInRef.current = false;
      closeStream?.();
      closeStream = null;
      setPrompt(null);
    };
    // 첫 구독은 아래 경로 effect 가 건다(같은 커밋 순서로 바로 뒤에 돈다) — 여기서도 부르면 로그인 확인이 두 번 나간다
    startRef.current = start;
    stopRef.current = stop;

    return () => {
      alive = false;
      closeStream?.();
      window.removeEventListener(DESKTOP_NOTIFY_EVENT, onChanged);
      window.removeEventListener("storage", onChanged);
      if (permStatus) permStatus.onchange = null;
      startRef.current = null;
      stopRef.current = null;
    };
  }, []);

  // 로그아웃(로그인 화면으로 이동)이면 멈추고, 로그인 뒤 다른 화면으로 오면 다시 붙인다
  useEffect(() => {
    if (under(pathname, SIGNED_OUT_PATHS)) stopRef.current?.();
    else startRef.current?.();
  }, [pathname]);

  if (!prompt || under(pathname, NO_PROMPT_PATHS)) return null;
  const turnOn = async () => {
    setBusy(true);
    try { await enableDesktopNotify(); } finally { setBusy(false); }
    // 결과(켜짐·차단·창 닫음)는 DESKTOP_NOTIFY_EVENT → onChanged 가 안내를 다시 계산한다
  };
  const later = () => {
    try { sessionStorage.setItem(PROMPT_LATER_KEY, "1"); } catch { /* noop */ }
    setPrompt(null);
  };
  const never = () => {
    saveDesktopNotifyChoice(false);
    setPrompt(null);
  };
  return (
    <div role="status"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] w-[min(460px,calc(100vw-32px))] rounded-xl border border-indigo-200 bg-white shadow-lg px-4 py-3">
      <p className="text-sm font-semibold text-gray-900">🔔 PC 알림이 꺼져 있습니다</p>
      {prompt === "ask" ? (
        <>
          <p className="text-xs text-gray-600 mt-1">공지·메시지를 놓치지 않도록 알림을 켜 주세요. 버튼을 누른 뒤 브라우저 창에서 [허용]을 누르면 됩니다.</p>
          <div className="flex items-center justify-end gap-2 mt-2.5">
            <button type="button" onClick={never} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">안 받기</button>
            <button type="button" onClick={later} className="text-xs text-gray-600 hover:bg-gray-100 rounded-md px-2.5 py-1.5">나중에</button>
            <button type="button" onClick={turnOn} disabled={busy}
              className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 rounded-md px-3 py-1.5">
              알림 켜기
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-xs text-gray-600 mt-1">
            브라우저가 큐브티 알림을 막았습니다. 주소창 왼쪽 자물쇠(앱 창은 오른쪽 위 ⋯ → 앱 정보)를 눌러
            <b> 알림 → 허용</b>으로 바꿔 주세요. 바꾸면 이 안내는 저절로 사라집니다.
          </p>
          <div className="flex items-center justify-end gap-2 mt-2.5">
            <button type="button" onClick={never} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1">안 받기</button>
            <button type="button" onClick={later} className="text-xs text-gray-600 hover:bg-gray-100 rounded-md px-2.5 py-1.5">닫기</button>
          </div>
        </>
      )}
    </div>
  );
}
