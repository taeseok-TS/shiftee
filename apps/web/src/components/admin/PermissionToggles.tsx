"use client";

// 역할별 권한 켜기·끄기(QA76 #39) — 권한 설정 화면 위쪽. 바꾸면 바로 저장(실패하면 되돌림)
// 새 톤(2026-10-21 본부 시안 R15): 「원장 권한」 · 「직원 권한」 두 칸 박스 + 아래 「고정된 규칙」(접힘).
// 권한 줄 = 제목(+ 「시프티와 다름」 노랑 알약) → 사람이 읽는 두 줄(brief) → 「적용 범위 보기 ›」(자세한 설명 · 적용되는 화면 — 사람 말만, 2026-10-23 ■0-2) · 오른쪽 「켬 · 끔」 + 인디고 스위치
// 권한 설정 화면은 세 탭(켜고 끄는 권한 · 역할별로 할 수 있는 일 · 고정된 규칙, 시안 S3) — 위 두 칸은 showFixed=false, 고정된 규칙은 FixedRules 를 따로 그린다
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Lock, ShieldCheck, UserRound } from "lucide-react";
import { Box, Toggle } from "@/components/kit";
import type { PermissionKey, PermissionSettings, PermissionToggle } from "@/lib/permission-settings";

type Fixed = { label: string; state: string; why: string };
type Props = { initial: PermissionSettings; toggles: PermissionToggle[]; fixed: Fixed[]; showFixed?: boolean; onChange?: (s: PermissionSettings) => void };

export default function PermissionToggles({ initial, toggles, fixed, showFixed = true, onChange }: Props) {
  const [settings, setSettings] = useState<PermissionSettings>(initial);
  const [busy, setBusy] = useState<PermissionKey | null>(null);
  // 저장이 끝난 값만 바깥(역할별 표)에 알린다 — 실패해 되돌린 값이 표에 남지 않게.
  // 바깥에 넘기는 값은 「서버가 받아 준 값」 ref 하나에서 만든다 — 렌더 때 잡힌 settings 로 만들면, 두 줄을 연달아 바꿀 때
  // 앞 줄이 실패해 되돌린 값(낙관적으로 바꿔 둔 값)이 뒤 줄 성공과 함께 표에 실려 남았다(검증 지적 10/23)
  const saved = useRef<PermissionSettings>(initial);
  const apply = (key: PermissionKey, v: boolean) => setSettings((s) => ({ ...s, [key]: v }));

  const flip = async (key: PermissionKey) => {
    const next = !settings[key];
    apply(key, next);
    setBusy(key);
    try {
      const res = await fetch("/api/admin/permissions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: next }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { apply(key, !next); onChange?.(saved.current); toast.error(d.error || "저장하지 못했습니다."); return; }
      saved.current = { ...saved.current, [key]: next };
      onChange?.(saved.current);
      const t = toggles.find((x) => x.key === key);
      toast.success(`${t?.label ?? key} ${next ? "켬" : "끔"} — 바로 적용됩니다.`);
    } catch {
      apply(key, !next); onChange?.(saved.current); toast.error("저장하지 못했습니다.");
    } finally { setBusy(null); }
  };

  const group = (role: "MANAGER" | "EMPLOYEE") => toggles.filter((t) => t.role === role);
  return (
    <>
      <div className="grid gap-[18px] lg:grid-cols-2">
        <Box icon={<ShieldCheck />} tone="ind" title="원장 권한" className="!mb-0 min-w-0">
          <div className="px-6 py-1">{group("MANAGER").map((t) => <ToggleRow key={t.key} t={t} on={settings[t.key]} busy={busy === t.key} onFlip={() => flip(t.key)} />)}</div>
        </Box>
        <Box icon={<UserRound />} tone="vio" title="직원 권한" className="!mb-0 min-w-0">
          <div className="px-6 py-1">{group("EMPLOYEE").map((t) => <ToggleRow key={t.key} t={t} on={settings[t.key]} busy={busy === t.key} onFlip={() => flip(t.key)} />)}</div>
        </Box>
      </div>
      {showFixed && <FixedRules fixed={fixed} />}
    </>
  );
}

// 토글 한 줄 — 바깥에 두어 매 렌더 재마운트(포커스 손실)가 없게
function ToggleRow({ t, on, busy, onFlip }: { t: PermissionToggle; on: boolean; busy: boolean; onFlip: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[#f1f5f9] py-4 first:border-t-0">
      <div className="min-w-0">
        <p className="text-[15.5px] font-bold text-[#0f172a]">{t.label}
          {on !== t.shiftee && <span className="ml-2 rounded-full bg-[#fffbeb] px-2 py-0.5 align-middle text-[12px] font-bold text-[#b45309]">시프티와 다름</span>}
        </p>
        <p className="mt-1 text-[13.5px] leading-snug text-[#475569]">{t.brief}</p>
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="mt-1.5 text-[13px] font-semibold text-[#4f46e5] hover:underline">
          {open ? "적용 범위 접기 ‹" : "적용 범위 보기 ›"}
        </button>
        {open && (
          <div className="mt-2 space-y-1 rounded-lg bg-[#f8fafc] px-3 py-2 text-[12.5px] text-[#596578]">
            <p>{t.hint}</p>
            <p className="text-[#7c8798]">적용되는 곳: {t.effects}</p>
          </div>
        )}
      </div>
      <div className="mt-0.5 shrink-0"><Toggle on={on} disabled={busy} onChange={onFlip} label={`${t.label} ${on ? "켬" : "끔"}`} /></div>
    </div>
  );
}

export function FixedRules({ fixed, defaultOpen = false }: { fixed: Fixed[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box icon={<Lock />} tone="sl" title="고정된 규칙" sub="설정으로 바꾸지 않음 · 이유와 함께" className="mt-[18px]"
      right={<button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="text-[#4f46e5] hover:underline">{open ? "접기 ‹" : "펼치기 ›"}</button>}>
      {open && (
        <ul className="grid gap-2 px-6 py-4 text-sm md:grid-cols-2">
          {fixed.map((f) => (
            <li key={f.label} className="flex gap-2 rounded-lg border border-[#eef1f5] bg-[#f8fafc] p-3">
              <Lock size={14} className="mt-0.5 shrink-0 text-[#94a3b8]" />
              <div><span className="font-semibold text-[#0f172a]">{f.label}</span> <span className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[12px] font-bold text-[#475569]">{f.state}</span>
                <p className="mt-0.5 text-[12.5px] text-[#596578]">{f.why}</p></div>
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}
