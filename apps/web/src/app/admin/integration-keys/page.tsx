"use client";

// 설정 › 연동 키 — 회사 연동 키(큐브마케팅 · 직영 포털 등 외부 프로그램용) 발급 · 현황 · 끄기.
// 2026-11-02 디렉터 회의 3번 「연동 키 발급은 모든 관리자가, 관리자 설정으로 빼기」 — 개발자 › API 키(최고 관리자 전용)에서 옮겨 왔다.
// 직원 개인 키 허용 · 현황은 그대로 개발자 › API 키에 있다.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, Power, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type KeyRow = { id: string; name: string; prefix: string; scopes: string[]; expiresAt: string; lastUsedAt: string | null; lastUsedIp: string | null; suspendReason: string | null; status: string; userName: string };

const statusLabel: Record<string, string> = { active: "사용 중", suspended: "멈춤", expired: "만료", revoked: "꺼짐" };

// 범위는 마케팅 자료 읽기·발행 결과 · DM 보내기 · 휴가 신청 읽기뿐(lib/api-key ORG_SCOPES). 원문은 발급 직후 한 번만.
const ORG_SCOPE_OPTS = [
  { id: "marketing:read", label: "마케팅 자료 읽기", hint: "지점이 올린 마케팅 자료·파일 가져가기" },
  { id: "marketing:publish", label: "발행 결과 되돌려주기", hint: "블로그 발행 주소를 기록하고 올린 직원에게 알림" },
  { id: "dm:send", label: "DM 보내기", hint: "사번으로 직원에게 1:1 알림 — 「에듀플렉스 알림」 계정으로(직영 포털 등)" },
  { id: "leave:read", label: "휴가 신청 읽기", hint: "휴가 신청 내역(사번·지점·유형·기간·사유·상태) — 직영 포털 원장 휴가 보고 등" },
];

export default function IntegrationKeysPage() {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("큐브마케팅 블로그 발행");
  const [scopes, setScopes] = useState<string[]>(["marketing:read", "marketing:publish"]);
  const [ttl, setTtl] = useState("365");
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<{ raw: string; name: string } | null>(null);
  const load = useCallback(() => {
    fetch("/api/admin/api-keys/org").then((r) => r.json()).then((d) => setKeys(d.keys || [])).catch(() => setKeys([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function create() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/api-keys/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, scopes, ttlDays: Number(ttl) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "발급하지 못했습니다."); return; }
      setSecret({ raw: d.secret, name }); setOpen(false); load();
    } finally { setSaving(false); }
  }
  async function revoke(k: KeyRow) {
    if (!confirm(`「${k.name}」 연동 키를 끌까요? 이 키를 쓰는 외부 연동이 바로 멈춥니다.`)) return;
    const res = await fetch(`/api/admin/api-keys/${k.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("끄지 못했습니다."); return; }
    toast.success("껐습니다."); load();
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><KeyRound className="text-indigo-600" />연동 키</h1>
        <p className="text-sm text-gray-500 mt-1">큐브마케팅 · 직영 포털 같은 외부 프로그램이 큐브티와 주고받을 때 쓰는 회사 연동 키입니다. 관리자라면 누구나 발급 · 끄기를 할 수 있습니다. <a href="/api/v1/docs" target="_blank" rel="noreferrer" className="text-indigo-600 inline-flex items-center gap-0.5"><ExternalLink size={12} />사용 안내</a></p>
      </div>

      <Card><CardContent className="pt-6 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-medium text-sm">회사 연동 키 ({keys?.length ?? 0}개)</p>
          <span className="text-xs text-gray-500">발급한 관리자가 강등 · 퇴사하거나 비밀번호가 초기화되면 키가 꺼지고 본부에 봇 DM 이 갑니다.</span>
          <Button size="sm" className="ml-auto gap-1 bg-indigo-600 hover:bg-indigo-700" onClick={() => setOpen(true)}><KeyRound size={14} />연동 키 발급</Button>
        </div>
        {secret && (
          <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm space-y-2">
            <p className="font-medium text-amber-800">「{secret.name}」 연동 키입니다. 지금 한 번만 보입니다 — 외부 프로그램 쪽에 안전하게 전달하고 여기서는 닫으세요.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all text-xs bg-white border rounded px-2 py-1.5">{secret.raw}</code>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(secret.raw).then(() => toast.success("복사했습니다.")).catch(() => toast.error("직접 선택해 복사해주세요.")); }}>복사</Button>
            </div>
            <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSecret(null)}>전달했습니다, 닫기</Button>
          </div>
        )}
        {open && (
          <div className="border rounded-lg p-3 space-y-3 bg-gray-50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2"><label className="text-xs text-gray-500">용도</label><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></div>
              <div><label className="text-xs text-gray-500">만료</label>
                <select className="block h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm" value={ttl} onChange={(e) => setTtl(e.target.value)}>
                  <option value="90">90일</option><option value="180">180일</option><option value="365">1년</option>
                </select></div>
            </div>
            <div className="space-y-1.5">
              {ORG_SCOPE_OPTS.map((s) => (
                <label key={s.id} className="flex items-start gap-2 text-sm cursor-pointer">
                  <input type="checkbox" className="mt-1" checked={scopes.includes(s.id)} onChange={() => setScopes((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))} />
                  <span><span className="font-medium">{s.label}</span> <span className="text-xs text-gray-500">— {s.hint}</span></span>
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-500">이 키는 발급한 관리자에게 매입니다. 발급자가 관리자에서 내려오거나 비밀번호가 초기화되면 키도 멈추니, 그때는 새로 발급해주세요.</p>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>취소</Button>
              <Button size="sm" className="bg-indigo-600 hover:bg-indigo-700" disabled={saving || !name.trim() || !scopes.length} onClick={create}>{saving ? "발급 중…" : "발급"}</Button>
            </div>
          </div>
        )}
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="bg-gray-50 text-gray-600"><tr><th className="text-left p-2">용도</th><th className="text-left p-2">발급자</th><th className="text-left p-2">범위</th><th className="text-left p-2">상태</th><th className="text-left p-2">마지막 사용</th><th className="text-left p-2">만료</th><th className="p-2"></th></tr></thead>
            <tbody>
              {(keys ?? []).map((k) => (
                <tr key={k.id} className={`border-t ${k.status === "revoked" || k.status === "expired" ? "opacity-50" : ""}`}>
                  <td className="p-2">{k.name} <span className="text-gray-400">cbt_pk_{k.prefix}…</span></td>
                  <td className="p-2">{k.userName}</td>
                  <td className="p-2">{k.scopes.join(", ")}</td>
                  <td className="p-2">{statusLabel[k.status] ?? k.status}{k.suspendReason ? ` (${k.suspendReason})` : ""}</td>
                  <td className="p-2">{k.lastUsedAt ? `${format(new Date(k.lastUsedAt), "M/d HH:mm")} ${k.lastUsedIp ?? ""}` : "-"}</td>
                  <td className="p-2">{format(new Date(k.expiresAt), "yyyy-MM-dd")}</td>
                  <td className="p-2 text-right">{(k.status === "active" || k.status === "suspended") && <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600" onClick={() => revoke(k)}><Power size={12} />끄기</Button>}</td>
                </tr>
              ))}
              {keys !== null && !keys.length && <tr><td colSpan={7} className="p-4 text-center text-gray-400">발급한 연동 키가 없습니다.</td></tr>}
              {keys === null && <tr><td colSpan={7} className="p-4 text-center text-gray-400">불러오는 중…</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}
