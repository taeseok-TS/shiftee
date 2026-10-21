"use client";

// 직원이 메일·알림 링크로 계약서를 열 때 첫 화면(시안 v2 5번) — 받은 서류와 비밀번호 한 칸.
// 비밀번호 한 번으로 내 서명 차례 서류를 모두 열고(/api/contracts/unlock), 계약서 화면의 첫 서류 서명 창으로 바로 간다.
import { ReauthPasswordInput } from "@/components/ui/reauth-password-input";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrivalCard, arrivalHeading, deadlineLabel } from "@/components/contracts/ArrivalCard";

export default function Arrival({ org, name, items, sender, deadline }: {
  org: string;
  name: string;
  items: { id: string; title: string }[];
  sender: string | null;
  deadline: string | null;
}) {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nowMs] = useState(() => Date.now());
  const titles = items.map((x) => x.title);

  async function open() {
    if (!pw || busy) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/contracts/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: items.map((x) => x.id), password: pw }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setError(d.error || "본인 확인에 실패했습니다."); return; }
      const ok: string[] = Array.isArray(d.ids) ? d.ids : [];
      const first = items.find((x) => ok.includes(x.id))?.id || items[0].id;   // 화면에 보인 순서(기한 먼저)의 첫 서류
      router.push(`/contracts?sign=${encodeURIComponent(first)}`);
    } catch { setError("네트워크 오류가 발생했습니다. 다시 눌러 주세요."); }
    finally { setBusy(false); }
  }

  return (
    <ArrivalCard org={org} heading={arrivalHeading(titles)} greeting={`${name} 님, 아래 서류를 확인하고 서명해 주세요.`}
      titles={titles} sender={sender} deadline={deadlineLabel(deadline, nowMs)}>
      <form onSubmit={(e) => { e.preventDefault(); void open(); }} className="space-y-2">
        <ReauthPasswordInput plain autoFocus value={pw} onChange={(e) => setPw(e.target.value)} aria-label="큐브티 로그인 비밀번호"
          className="w-full rounded-xl border px-4 py-3 text-base" placeholder="큐브티 로그인 비밀번호" />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button type="submit" disabled={busy || !pw} className="w-full rounded-xl bg-indigo-600 py-3.5 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "확인 중…" : "계약서 열기"}
        </button>
      </form>
    </ArrivalCard>
  );
}
