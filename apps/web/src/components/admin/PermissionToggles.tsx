"use client";

// 역할별 권한 켜기·끄기(QA76 #39) — 권한 설정 화면 위쪽. 바꾸면 바로 저장(실패하면 되돌림)
import { useState } from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PermissionKey, PermissionSettings, PermissionToggle } from "@/lib/permission-settings";

type Fixed = { label: string; state: string; why: string };
type Props = { initial: PermissionSettings; toggles: PermissionToggle[]; fixed: Fixed[] };

export default function PermissionToggles({ initial, toggles, fixed }: Props) {
  const [settings, setSettings] = useState<PermissionSettings>(initial);
  const [busy, setBusy] = useState<PermissionKey | null>(null);

  const flip = async (key: PermissionKey) => {
    const next = !settings[key];
    setSettings((s) => ({ ...s, [key]: next }));
    setBusy(key);
    try {
      const res = await fetch("/api/admin/permissions", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [key]: next }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setSettings((s) => ({ ...s, [key]: !next })); toast.error(d.error || "저장하지 못했습니다."); return; }
      const t = toggles.find((x) => x.key === key);
      toast.success(`${t?.label ?? key} ${next ? "켬" : "끔"} — 바로 적용됩니다.`);
    } catch {
      setSettings((s) => ({ ...s, [key]: !next })); toast.error("저장하지 못했습니다.");
    } finally { setBusy(null); }
  };

  const group = (role: "MANAGER" | "EMPLOYEE") => toggles.filter((t) => t.role === role);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">원장 권한</CardTitle></CardHeader>
        <CardContent className="space-y-3">{group("MANAGER").map((t) => <ToggleRow key={t.key} t={t} on={settings[t.key]} busy={busy === t.key} onFlip={() => flip(t.key)} />)}</CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">직원 권한</CardTitle></CardHeader>
        <CardContent className="space-y-3">{group("EMPLOYEE").map((t) => <ToggleRow key={t.key} t={t} on={settings[t.key]} busy={busy === t.key} onFlip={() => flip(t.key)} />)}</CardContent>
      </Card>
      <FixedRules fixed={fixed} />
    </div>
  );
}

// 토글 한 줄 — 바깥에 두어 매 렌더 재마운트(포커스 손실)가 없게
function ToggleRow({ t, on, busy, onFlip }: { t: PermissionToggle; on: boolean; busy: boolean; onFlip: () => void }) {
    return (
      <div className="flex items-start justify-between gap-4 p-4 border rounded-lg">
        <div className="min-w-0">
          <p className="font-medium text-gray-900">{t.label}
            {on !== t.shiftee && <span className="ml-2 text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">시프티와 다름</span>}
          </p>
          <p className="text-xs text-gray-500 mt-1">{t.hint}</p>
          <p className="text-[11px] text-gray-400 mt-1">적용 범위: {t.effects}</p>
        </div>
        <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1" aria-label={`${t.label} ${on ? "켬" : "끔"}`}>
          <input type="checkbox" className="sr-only peer" checked={on} disabled={busy} onChange={onFlip} />
          <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:bg-blue-600 after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-5" />
          <span className="ml-2 text-xs w-6 text-gray-600">{on ? "켬" : "끔"}</span>
        </label>
      </div>
    );
}

function FixedRules({ fixed }: { fixed: Fixed[] }) {
  return (
      <Card className="lg:col-span-2">
        <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Lock size={15} />고정된 규칙(설정으로 바꾸지 않음)</CardTitle></CardHeader>
        <CardContent>
          <ul className="grid gap-2 md:grid-cols-2 text-sm">
            {fixed.map((f) => (
              <li key={f.label} className="flex gap-2 p-3 border rounded-lg bg-gray-50/60">
                <Lock size={14} className="mt-0.5 shrink-0 text-gray-400" />
                <div><span className="font-medium text-gray-800">{f.label}</span> <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">{f.state}</span>
                  <p className="text-xs text-gray-500 mt-0.5">{f.why}</p></div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
  );
}
