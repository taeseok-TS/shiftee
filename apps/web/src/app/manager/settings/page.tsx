"use client";

// 원장 「설정 › 환경설정」 — R15(권한 설정)와 같은 박스 · 스위치(kit Toggle). 줄 = 제목 15.5px 굵게 + 회색 설명 · 오른쪽 「켬 · 끔」 + 인디고 스위치
//
// 2026-10-23 디렉터 결정 — 종전 화면은 스위치 3개가 저장 TODO 라 아무 알림도 바뀌지 않았다(「저장됐다」 토스트만). 이제 실제로 동작한다.
//  · 「알림」: 직원 환경설정과 같은 실제 설정(PC 알림 · 채팅 알림 · 결재 결과 알림) — components/settings/NotifySettings
//  · 「원장 알림」: 결재 요청 알림(봇 DM · 앱 푸시) · 결재 요청 메일 · 지점 직원 변동 알림 — /api/me/prefs `notify` 키(lib/notify-prefs-core)
//    본부 「결재 알림 강제」가 켜져 있으면 결재 요청 두 줄은 잠긴다(서버도 무시하고 보낸다). 원장(MANAGER) 계정에만 적용.
// 저장 버튼이 없다 — 바꾸면 바로 저장, 실패하면 스위치를 되돌린다(직원 환경설정과 같다).
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Bell, Building2 } from "lucide-react";
import { Box, PageHead, Toggle } from "@/components/kit";
import { ApprovalResultRow, ChatNotifyRow, DesktopNotifyRow, SettingRow, useAccountNotify } from "@/components/settings/NotifySettings";
import { DEFAULT_MANAGER_NOTIFY, parseManagerNotify, type ManagerNotifyKey, type ManagerNotifyPrefs } from "@/lib/notify-prefs-core";

const ROWS: Record<ManagerNotifyKey, { label: string; desc: string; on: string; off: string; forcible: boolean }> = {
  approvalRequest: {
    label: "결재 요청 알림",
    desc: "내 결재 차례가 된 휴가 · 근무일정 · 휴가 취소 · 출퇴근 요청 · 기기 변경 · 전자계약 결재를 큐브티 봇 대화방과 앱 푸시로 알려드립니다. 끄면 봇 메시지 · 푸시 · 전자계약 미결재 리마인더가 오지 않습니다 — 결재함에는 그대로 뜹니다. 알림만 끕니다.",
    on: "결재 요청 알림을 받습니다.",
    off: "결재 요청 알림을 껐습니다. 결재함에는 그대로 뜹니다.",
    forcible: true,
  },
  approvalEmail: {
    label: "결재 요청 메일",
    desc: "전자계약 결재(서명) 차례가 되면 메일로도 알려드립니다. 끄면 메일만 오지 않습니다 — 봇 알림 · 결재함은 그대로입니다. (휴가 · 근무일정 결재 요청은 원래 메일로 가지 않습니다.)",
    on: "결재 요청 메일을 받습니다.",
    off: "결재 요청 메일을 껐습니다. 봇 알림 · 결재함은 그대로입니다.",
    forcible: true,
  },
  staffChange: {
    label: "지점 직원 변동 알림",
    desc: "담당 지점(겸직 포함)에 직원이 입사 등록되거나 퇴사 · 비활성화 · 재입사 처리되면 큐브티 봇이 알려드립니다. 여러 명이면 지점별 한 통으로 묶습니다. 끄면 이 알림만 오지 않습니다 — 직원 목록에는 그대로 반영됩니다.",
    on: "지점 직원 변동 알림을 받습니다.",
    off: "지점 직원 변동 알림을 껐습니다.",
    forcible: false,
  },
};
const ORDER: ManagerNotifyKey[] = ["approvalRequest", "approvalEmail", "staffChange"];

export default function ManagerSettingsPage() {
  const acct = useAccountNotify();

  // ── 원장 알림(서버 저장 — 사람마다, 모든 기기에 함께) ──
  const [prefs, setPrefs] = useState<ManagerNotifyPrefs>({ ...DEFAULT_MANAGER_NOTIFY });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me/prefs")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setPrefs(parseManagerNotify(d?.prefs?.notify)))
      .then(() => setLoaded(true))
      .catch(() => toast.error("원장 알림 설정을 불러오지 못했습니다. 화면을 새로고침해주세요."));
    // 관리자 계정이 원장 모드를 연 경우 안내용(설정은 원장 계정에만 적용된다)
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => setRole(d?.user?.role ?? null)).catch(() => {});
  }, []);

  const change = async (k: ManagerNotifyKey, on: boolean) => {
    setPrefs((s) => ({ ...s, [k]: on }));
    setSaving(true);
    const revert = () => setPrefs((s) => ({ ...s, [k]: !on }));
    try {
      const res = await fetch("/api/me/prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notify: { [k]: on } }),   // 서버가 보낸 칸만 덮어쓴다
      });
      if (!res.ok) { revert(); toast.error("설정을 저장하지 못했습니다. 다시 시도해주세요."); return; }
      toast.success(on ? ROWS[k].on : ROWS[k].off);
    } catch {
      revert();
      toast.error("서버에 연결하지 못했습니다. 다시 시도해주세요.");
    } finally {
      setSaving(false);
    }
  };

  const row = (k: ManagerNotifyKey) => {
    const locked = ROWS[k].forcible && acct.forced;
    const on = locked ? true : prefs[k];
    return (
      <SettingRow
        key={k}
        title={ROWS[k].label}
        desc={locked
          ? <><span className="mr-1.5 inline-block rounded bg-[#f1f5f9] px-1.5 py-px text-[12px] font-semibold text-[#64748b]">본부가 켜 둠</span>본부가 결재 알림을 강제로 켜 두어 끌 수 없습니다.</>
          : ROWS[k].desc}
      >
        <Toggle
          on={on}
          disabled={locked || !loaded || !acct.loaded || saving}
          label={`${ROWS[k].label} ${on ? "켬" : "끔"}`}
          onChange={(v) => change(k, v)}
        />
      </SettingRow>
    );
  };

  return (
    <div className="pb-10">
      <PageHead crumb="설정 › 환경설정" title="환경설정" note="원장 설정 · 바꾸면 바로 저장" />

      <div className="grid gap-[18px] lg:grid-cols-2">
        <Box icon={<Bell />} tone="ind" title="알림" className="!mb-0 min-w-0">
          <div className="px-6 py-1">
            <DesktopNotifyRow />
            <ChatNotifyRow acct={acct} />
            <ApprovalResultRow acct={acct} />
          </div>
          <p className="border-t border-[#eef1f5] px-6 py-3 text-[12.5px] text-[#596578]">
            PC 알림은 <b>지금 쓰는 브라우저에만</b>, 나머지는 <b>모든 기기에 함께</b> 적용됩니다. 직원 환경설정 · 휴대폰 앱과 같은 설정입니다.
          </p>
        </Box>

        <Box icon={<Building2 />} tone="vio" title="원장 알림" sub="모든 기기에 함께" className="!mb-0 min-w-0">
          <div className="px-6 py-1">{ORDER.map(row)}</div>
          <p className="border-t border-[#eef1f5] px-6 py-3 text-[12.5px] text-[#596578]">
            {role === "ADMIN"
              ? <>관리자 계정으로 보고 계십니다. 원장 알림 설정은 <b>원장 계정에만</b> 적용됩니다 — 관리자는 결재 요청을 늘 받고, 지점 직원 변동 알림은 원장에게만 갑니다.</>
              : <>본부가 「결재 알림 강제」를 켜 두면 결재 요청 알림 · 메일은 끌 수 없습니다.</>}
          </p>
        </Box>
      </div>
    </div>
  );
}
