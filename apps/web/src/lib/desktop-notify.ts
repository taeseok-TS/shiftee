// PC(브라우저) 알림 켜짐 여부 — 채팅 종 아이콘·환경설정·전역 알림기·켜기 안내가 모두 이 규칙 하나를 쓴다.
//
// 2026-09-18 디렉터: "브라우저 문제로 자꾸 켤 때마다 알림이 꺼져서 다시 설정" 한다.
// 종전에는 localStorage 에 "on" 이 **있어야만** 켜짐으로 봤다. 그래서 기록이 비면(저장공간 정리·새 앱 창 등)
// 브라우저 허용이 살아 있어도 꺼졌다. 이제는 **직원이 직접 끈 경우("off")만** 꺼짐이고,
// 브라우저 허용이 있으면 기본으로 켜진다. 허용 자체가 풀린 경우는 코드로 되살릴 수 없어서
// (브라우저가 직원의 클릭을 요구한다) 켜기 안내(DesktopNotifyPrompt)가 한 번 클릭으로 복구하게 한다.
export const DESKTOP_NOTIFY_KEY = "workDesktopNotify";
export const DESKTOP_NOTIFY_EVENT = "workDesktopNotifyChanged";

export type DesktopNotifyState =
  | "unsupported" // 브라우저가 알림을 모름
  | "denied"      // 브라우저가 막음 — 직원이 사이트 설정에서 풀어야 한다
  | "ask"         // 켜려는 상태인데 브라우저 허용이 아직 없음 — 클릭 한 번이면 켜진다
  | "off"         // 직원이 직접 끔
  | "on";

// 저장공간이 막힌 브라우저(모든 쿠키 차단 등)에서도 이 창이 떠 있는 동안은 선택이 먹게 — 안 그러면
// "끄기"를 눌러도 허용이 살아 있어 다시 켜짐으로 읽힌다(검증 notify1 #3).
let memoryChoice: string | null = null;

/** 저장된 선택 — "on" | "off" | null(아직 고른 적 없거나 지워짐). */
export function readDesktopNotifyChoice(): string | null {
  try { return localStorage.getItem(DESKTOP_NOTIFY_KEY) ?? memoryChoice; } catch { return memoryChoice; }
}

export function readDesktopNotifyState(): DesktopNotifyState {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  const choice = readDesktopNotifyChoice();
  if (choice === "off") return "off";
  if (Notification.permission === "granted") return "on";
  if (Notification.permission === "denied") return "denied";
  return "ask";
}

export function saveDesktopNotifyChoice(on: boolean) {
  memoryChoice = on ? "on" : "off";
  try { localStorage.setItem(DESKTOP_NOTIFY_KEY, memoryChoice); } catch { /* 저장 불가 — 이 창에서만 기억 */ }
  window.dispatchEvent(new Event(DESKTOP_NOTIFY_EVENT));
}

/** 켜기 — 허용이 없으면 여기서 묻는다(반드시 클릭 처리 안에서 불러야 브라우저가 창을 띄운다). */
export async function enableDesktopNotify(): Promise<DesktopNotifyState> {
  if (typeof Notification === "undefined") return "unsupported";
  const before = Notification.permission;
  const perm = before === "granted" ? "granted" : await Notification.requestPermission();
  if (perm === "denied") {
    // 묻는 창에서 직접 [차단]을 눌렀을 때만(요청 전 default) 끈 것으로 저장한다 — "허용으로 바꿔 주세요"
    // 안내가 켤 때마다 따라다니지 않게(검증 notify1 #1). 이미 막혀 있던 상태에서 켜려고 누른 것이면
    // 켜려는 뜻이니 켬으로 저장한다 — 사이트 설정에서 허용으로 풀면 바로 켜지고(notify2 A),
    // 예전에 끔이었던 직원도 안내대로 풀기만 하면 된다(notify3 B). 풀기 전까지는 푸는 방법 안내가 뜬다.
    saveDesktopNotifyChoice(before !== "default");
    return "denied";
  }
  if (perm !== "granted") {
    // 창을 그냥 닫았으면(default) 선택은 건드리지 않는다 — 다음에 켤 때 다시 안내한다
    window.dispatchEvent(new Event(DESKTOP_NOTIFY_EVENT));
    return "ask";
  }
  saveDesktopNotifyChoice(true);
  return "on";
}
