"use client";

// 환경설정 알림 줄 공용 조각(2026-10-23 — 원장 「설정 › 환경설정」이 직원 환경설정과 같은 실제 설정을 쓰게).
// 동작·문구는 직원 환경설정(src/app/(dashboard)/settings/page.tsx)과 같다 — 바꾸면 바로 저장, 실패하면 스위치를 되돌린다.
//  · PC 알림: 이 브라우저에만(localStorage, lib/desktop-notify) — 채팅 화면 종 아이콘과 같은 스위치
//  · 채팅 알림(workMuteAll) · 결재 결과 알림(notifyApproval): 계정 설정(/api/me/notify), 본부 강제(forced)면 결재 결과 알림 잠김
// ⚠ 직원 환경설정 화면은 아직 자기 안에 같은 코드를 갖고 있다(그 파일은 이번에 고치지 않음). 두 곳을 함께 맞출 것.
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Btn, Toggle } from "@/components/kit";
import {
  DESKTOP_NOTIFY_EVENT, enableDesktopNotify, readDesktopNotifyState, saveDesktopNotifyChoice,
} from "@/lib/desktop-notify";

/** R15 줄 — 제목 15.5px 굵게 + 회색 설명 · 오른쪽 스위치 */
export function SettingRow({ title, desc, children }: { title: string; desc: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[#f1f5f9] py-4 first:border-t-0">
      <div className="min-w-0">
        <p className="text-[15.5px] font-bold text-[#0f172a]">{title}</p>
        <p className="mt-1 text-[13.5px] leading-snug text-[#475569]">{desc}</p>
      </div>
      <div className="mt-0.5 shrink-0">{children}</div>
    </div>
  );
}

type BrowserState = "unsupported" | "denied" | "off" | "on";

/** PC 알림 줄(이 브라우저에만) + 켜져 있으면 「시험 알림」 안내. 저장은 이 브라우저의 localStorage. */
// 브라우저 상태 읽기 — 브라우저가 막고 있으면 끈 기록보다 먼저 알려 준다(켜려면 사이트 설정부터 풀어야 하니까).
// "ask"(허용이 아직 없음)는 스위치에선 꺼짐으로 보이고, 켜면 브라우저가 허용을 묻는다.
function readBrowser(): BrowserState {
  if (typeof Notification !== "undefined" && Notification.permission === "denied") return "denied";
  const st = readDesktopNotifyState();
  return st === "ask" ? "off" : st;
}
// 채팅 화면의 종 아이콘·켜기 안내(같은 탭 — lib/desktop-notify 가 바꿀 때마다 이벤트를 쏜다)와 다른 탭의 변경을 함께 따라간다
function subscribeBrowser(cb: () => void) {
  window.addEventListener(DESKTOP_NOTIFY_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(DESKTOP_NOTIFY_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

export function DesktopNotifyRow() {
  const browser = useSyncExternalStore<BrowserState>(subscribeBrowser, readBrowser, () => "off");

  const toggle = async (on: boolean) => {
    if (!on) {
      saveDesktopNotifyChoice(false);
      toast.success("이 브라우저에서 PC 알림을 껐습니다.");
      return;
    }
    const st = await enableDesktopNotify();
    if (st === "unsupported") { toast.error("이 브라우저는 알림을 지원하지 않습니다."); return; }
    if (st !== "on") {
      toast.error("브라우저가 알림을 막고 있습니다. 주소창 왼쪽 자물쇠 → 알림 → 허용으로 바꿔주세요.");
      return;
    }
    toast.success("PC 알림을 켰습니다. 큐브티 어느 화면에 있어도 새 채팅을 알려드립니다.");
  };

  const test = () => {
    try {
      const n = new Notification("큐브티 알림 시험", { body: "이 알림이 보이면 PC 알림이 정상입니다.", tag: "qubetee-test" });
      setTimeout(() => n.close(), 6000);
      toast.success("시험 알림을 보냈습니다. 화면 오른쪽 아래를 확인해주세요.");
    } catch {
      toast.error("시험 알림을 띄우지 못했습니다. 윈도우 알림 설정을 확인해주세요.");
    }
  };

  return (
    <>
      <SettingRow
        title="PC 알림 (이 브라우저)"
        desc={
          browser === "unsupported" ? "이 브라우저는 알림을 지원하지 않습니다."
          : browser === "denied" ? "브라우저가 알림을 막고 있습니다. 주소창 왼쪽 자물쇠 → 알림 → 허용."
          : "새 채팅이 오면 큐브티 어느 화면에 있어도 바탕화면에 알려드립니다. 지금 쓰는 브라우저에만 적용됩니다."
        }
      >
        <Toggle
          on={browser === "on"}
          disabled={browser === "unsupported" || browser === "denied"}
          onChange={toggle}
          label={`PC 알림 ${browser === "on" ? "켬" : "끔"}`}
        />
      </SettingRow>
      {browser === "on" && (
        <div className="mb-3 flex items-center justify-between gap-4 rounded-lg bg-[#f8fafc] px-3 py-2.5">
          <p className="text-[13px] text-[#475569]">
            알림이 안 보이면 윈도우 <b>집중 지원</b>이 켜져 있을 수 있습니다. 한번 확인해보세요.
          </p>
          <Btn onClick={test} className="shrink-0">시험 알림</Btn>
        </div>
      )}
    </>
  );
}

/** 계정 알림 상태(/api/me/notify) — 채팅 알림·결재 결과 알림·본부 강제 여부. 바꾸면 바로 저장, 실패하면 되돌림. */
export function useAccountNotify() {
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workMuteAll, setWorkMuteAll] = useState(false);
  const [notifyApproval, setNotifyApproval] = useState(true);
  const [forced, setForced] = useState(false);

  useEffect(() => {
    fetch("/api/me/notify")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setWorkMuteAll(!!d.workMuteAll);
        setNotifyApproval(d.notifyApproval !== false);
        setForced(!!d.forced);
      })
      .catch(() => toast.error("알림 설정을 불러오지 못했습니다."))
      .finally(() => setLoaded(true));
  }, []);

  const save = async (body: Record<string, boolean>, revert: () => void, done: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/me/notify", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { revert(); toast.error("설정을 저장하지 못했습니다. 다시 시도해주세요."); return; }
      toast.success(done);
    } catch {
      revert();
      toast.error("서버에 연결하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  const setChatOn = (on: boolean) => {
    const mute = !on;
    setWorkMuteAll(mute);
    save({ workMuteAll: mute }, () => setWorkMuteAll(!mute),
      mute ? "채팅 알림을 껐습니다. 메시지는 정상 수신됩니다." : "채팅 알림을 다시 받습니다.");
  };
  const setApprovalResultOn = (on: boolean) => {
    setNotifyApproval(on);
    save({ notifyApproval: on }, () => setNotifyApproval(!on),
      on ? "결재 결과 푸시를 받습니다." : "결재 결과 푸시를 껐습니다. 봇 대화방에는 계속 남습니다.");
  };

  return { loaded, saving, workMuteAll, notifyApproval, forced, setChatOn, setApprovalResultOn };
}

export type AccountNotify = ReturnType<typeof useAccountNotify>;

/** 큐브티워크 채팅 알림 줄(workMuteAll) */
export function ChatNotifyRow({ acct }: { acct: AccountNotify }) {
  const on = !acct.workMuteAll;
  return (
    <SettingRow title="채팅 알림 (큐브티워크)" desc="끄면 채팅·공지·리마인더 알림이 오지 않습니다. 메시지는 정상적으로 쌓입니다.">
      <Toggle on={on} disabled={!acct.loaded || acct.saving} label={`채팅 알림 ${on ? "켬" : "끔"}`} onChange={acct.setChatOn} />
    </SettingRow>
  );
}

/** 결재 결과 알림 줄(notifyApproval) — 내가 올린 신청의 승인/반려. 본부 강제면 잠김 */
export function ApprovalResultRow({ acct }: { acct: AccountNotify }) {
  const on = acct.forced ? true : acct.notifyApproval;
  return (
    <SettingRow
      title="결재 결과 알림"
      desc={acct.forced
        ? "관리자 정책으로 항상 발송됩니다."
        : "내가 올린 휴가·근무일정의 승인/반려를 푸시로 알려드립니다. 꺼도 큐브티 봇 대화방에는 남습니다. 전자계약 반려·서명 거부는 항상 알립니다."}
    >
      <Toggle on={on} disabled={acct.forced || !acct.loaded || acct.saving} label={`결재 결과 알림 ${on ? "켬" : "끔"}`} onChange={acct.setApprovalResultOn} />
    </SettingRow>
  );
}
