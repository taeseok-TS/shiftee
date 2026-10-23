"use client";

// 환경설정 — 알림 켜고 끄기 (2026-09-06)
//
// ⚠ 종전 이 화면은 껍데기였다. 체크박스 두 개("이메일 알림"·"푸시 알림")는 `defaultChecked` 로
//   그려져 있을 뿐 아무 것도 하지 않았고, 저장 버튼은 `TODO` 인 채 "설정이 저장되었습니다"
//   토스트만 띄웠다 — 직원에게 **저장됐다고 거짓말하는** 화면이었다. 전부 걷어내고
//   실제로 동작하는 것만 남긴다.
//
// 저장 버튼이 없는 이유: 토글이 바로 저장된다(디렉터 지시 — 클릭 수를 늘리지 않는다).
// 실패하면 스위치를 되돌리고 알린다.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, MonitorSmartphone, UserRound } from "lucide-react";
import { PageHead, Box, Btn, Toggle } from "@/components/kit";
import {
  DESKTOP_NOTIFY_EVENT, enableDesktopNotify, readDesktopNotifyState, saveDesktopNotifyChoice,
} from "@/lib/desktop-notify";

// 새 톤(2026-10-21 본부 시안 「원장 · 직원 나머지 화면」 — 환경설정 = R15 권한 설정과 같은 박스 · 스위치).
// 줄 = 제목 15.5px 굵게 → 설명(13.5px 회색) · 오른쪽 「켬 · 끔」 글자 + 인디고 스위치(kit Toggle).
// 프로필 화면의 같은 설정도 같은 뜻이다 — 켬/끔 판정은 이 화면 그대로(바꾸면 바로 저장, 실패하면 되돌림).
function Row({ title, desc, children }: { title: string; desc: React.ReactNode; children: React.ReactNode }) {
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

export default function SettingsPage() {
  // ── PC 알림 (이 브라우저에만 적용 — 서버가 아니라 localStorage 에 저장한다) ──
  // 채팅 화면 사이드바의 종 아이콘과 **같은 스위치**다. 한쪽에서 바꾸면 다른 쪽도 따라간다.
  const [browser, setBrowser] = useState<BrowserState>("off");
  // 켜짐 규칙은 lib/desktop-notify 하나 — 직접 끈 경우만 꺼짐(허용이 있으면 기록이 비어도 켜짐).
  // "ask"(허용이 아직 없음)는 스위치에선 꺼짐으로 보이고, 켜면 브라우저가 허용을 묻는다.
  const readBrowser = useCallback((): BrowserState => {
    // 브라우저가 막고 있으면 끈 기록보다 먼저 알려 준다 — 켜려면 사이트 설정부터 풀어야 하니까
    if (typeof Notification !== "undefined" && Notification.permission === "denied") return "denied";
    const st = readDesktopNotifyState();
    return st === "ask" ? "off" : st;
  }, []);
  useEffect(() => {
    setBrowser(readBrowser());
    // 채팅 화면의 종 아이콘·켜기 안내(같은 탭)와 다른 탭의 변경을 함께 따라간다
    const sync = () => setBrowser(readBrowser());
    window.addEventListener(DESKTOP_NOTIFY_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(DESKTOP_NOTIFY_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [readBrowser]);

  const toggleBrowser = async (on: boolean) => {
    if (!on) {
      saveDesktopNotifyChoice(false);
      setBrowser("off");
      toast.success("이 브라우저에서 PC 알림을 껐습니다.");
      return;
    }
    // 권한을 아직 안 물었으면 여기서 묻는다. 이미 차단돼 있으면 코드로는 풀 수 없다.
    const st = await enableDesktopNotify();
    if (st === "unsupported") {
      toast.error("이 브라우저는 알림을 지원하지 않습니다.");
      return;
    }
    if (st !== "on") {
      setBrowser(st === "denied" ? "denied" : "off");
      toast.error("브라우저가 알림을 막고 있습니다. 주소창 왼쪽 자물쇠 → 알림 → 허용으로 바꿔주세요.");
      return;
    }
    setBrowser("on");
    toast.success("PC 알림을 켰습니다. 큐브티 어느 화면에 있어도 새 채팅을 알려드립니다.");
  };

  // 켰는데 실제로 안 뜨는 경우가 흔하다(윈도우 집중 지원, 브라우저 방해 금지, 알림 센터).
  // 직원이 스스로 확인할 수 있게 시험 알림을 하나 띄운다.
  const testBrowser = () => {
    try {
      const n = new Notification("큐브티 알림 시험", {
        body: "이 알림이 보이면 PC 알림이 정상입니다.",
        tag: "qubetee-test",
      });
      setTimeout(() => n.close(), 6000);
      toast.success("시험 알림을 보냈습니다. 화면 오른쪽 아래를 확인해주세요.");
    } catch {
      toast.error("시험 알림을 띄우지 못했습니다. 윈도우 알림 설정을 확인해주세요.");
    }
  };

  // ── 계정 설정 (서버 저장 — 어느 기기에서든 같이 적용) ──
  const [loaded, setLoaded] = useState(false);
  const [workMuteAll, setWorkMuteAll] = useState(false);
  const [notifyApproval, setNotifyApproval] = useState(true);
  const [approvalForced, setApprovalForced] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/me/notify")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setWorkMuteAll(!!d.workMuteAll);
        setNotifyApproval(d.notifyApproval !== false);
        setApprovalForced(!!d.forced);
      })
      .catch(() => toast.error("알림 설정을 불러오지 못했습니다."))
      .finally(() => setLoaded(true));
  }, []);

  // 서버 저장 — 실패하면 스위치를 되돌린다. "저장된 척"이 이 화면의 원래 문제였다.
  const save = async (body: Record<string, boolean>, revert: () => void, done: string) => {
    setSaving(true);
    try {
      const res = await fetch("/api/me/notify", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) { revert(); toast.error("설정을 저장하지 못했습니다. 다시 시도해주세요."); return; }
      toast.success(done);
    } catch {
      revert();
      toast.error("서버에 연결하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="pb-10">
      <PageHead crumb="설정 › 환경설정" title="환경설정" note="알림을 켜고 끕니다 · 바꾸면 바로 저장" />

      <div className="grid gap-[18px] lg:grid-cols-2">
        <Box icon={<MonitorSmartphone />} tone="ind" title="PC 알림" sub="지금 쓰는 브라우저에만" className="!mb-0 min-w-0">
          <div className="px-6 py-1">
            <Row
              title="채팅 알림 띄우기"
              desc={
                browser === "unsupported" ? "이 브라우저는 알림을 지원하지 않습니다."
                : browser === "denied" ? "브라우저가 알림을 막고 있습니다. 주소창 왼쪽 자물쇠 → 알림 → 허용."
                : "새 채팅이 오면 큐브티 어느 화면에 있어도 바탕화면에 알려드립니다."
              }
            >
              <Toggle
                on={browser === "on"}
                disabled={browser === "unsupported" || browser === "denied"}
                onChange={toggleBrowser}
                label={`채팅 알림 띄우기 ${browser === "on" ? "켬" : "끔"}`}
              />
            </Row>

            {browser === "on" && (
              <div className="mb-3 flex items-center justify-between gap-4 rounded-lg bg-[#f8fafc] px-3 py-2.5">
                <p className="text-[13px] text-[#475569]">
                  알림이 안 보이면 윈도우 <b>집중 지원</b>이 켜져 있을 수 있습니다. 한번 확인해보세요.
                </p>
                <Btn onClick={testBrowser} className="shrink-0">시험 알림</Btn>
              </div>
            )}
          </div>
          <p className="border-t border-[#eef1f5] px-6 py-3 text-[12.5px] text-[#596578]">
            PC 알림은 <b>지금 쓰는 브라우저에만</b> 적용됩니다. 다른 컴퓨터에서도 받으시려면 그
            컴퓨터에서 한 번 더 켜주세요.
          </p>
        </Box>

        <Box icon={<Bell />} tone="vio" title="계정 알림" sub="모든 기기에 함께" className="!mb-0 min-w-0">
          <div className="px-6 py-1">
            <Row
              title="채팅 알림 (큐브티워크)"
              desc="끄면 채팅·공지·리마인더 알림이 오지 않습니다. 메시지는 정상적으로 쌓입니다."
            >
              <Toggle
                on={!workMuteAll}
                disabled={!loaded || saving}
                label={`채팅 알림 ${!workMuteAll ? "켬" : "끔"}`}
                onChange={(on) => {
                  const mute = !on;
                  setWorkMuteAll(mute);
                  save({ workMuteAll: mute }, () => setWorkMuteAll(!mute),
                    mute ? "채팅 알림을 껐습니다. 메시지는 정상 수신됩니다." : "채팅 알림을 다시 받습니다.");
                }}
              />
            </Row>

            <Row
              title="결재 결과 알림"
              desc={approvalForced
                ? "관리자 정책으로 항상 발송됩니다."
                : "휴가·근무일정 승인/반려를 푸시로 알려드립니다. 꺼도 큐브티 봇 대화방에는 남습니다. 전자계약 반려·서명 거부는 항상 알립니다."}
            >
              <Toggle
                on={approvalForced ? true : notifyApproval}
                disabled={approvalForced || !loaded || saving}
                label={`결재 결과 알림 ${approvalForced || notifyApproval ? "켬" : "끔"}`}
                onChange={(on) => {
                  setNotifyApproval(on);
                  save({ notifyApproval: on }, () => setNotifyApproval(!on),
                    on ? "결재 결과 푸시를 받습니다." : "결재 결과 푸시를 껐습니다. 봇 대화방에는 계속 남습니다.");
                }}
              />
            </Row>
          </div>
          <p className="border-t border-[#eef1f5] px-6 py-3 text-[12.5px] text-[#596578]">
            계정 알림은 <b>모든 기기에 함께</b> 적용됩니다. 휴대폰 앱에서도 같은 설정입니다.
          </p>
        </Box>
      </div>

      <Box icon={<UserRound />} tone="sl" title="개인정보" className="mt-[18px]"
        right={<a href="/profile" className="text-[#4f46e5] hover:underline">프로필 ›</a>}>
        <p className="px-6 py-4 text-[14px] text-[#475569]">
          이름·연락처·비밀번호는 <a href="/profile" className="font-semibold text-[#4f46e5] hover:underline">프로필</a>에서 관리합니다.
        </p>
      </Box>
    </div>
  );
}
