"use client";

// 본부 › API 키 — 발급 허용(승인 ⑤: 켜 준 사람만) + 전체 키 현황·끄기 (2026-09-13 2단계)
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, Power, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type AllowedUser = { id: string; name: string; branch: string | null; jobGroup: string | null; role: string; isActive: boolean };
type KeyRow = { id: string; kind?: string; name: string; prefix: string; scopes: string[]; channelIds: string[]; expiresAt: string; lastUsedAt: string | null; lastUsedIp: string | null; suspendedAt: string | null; suspendReason: string | null; revokedAt: string | null; createdAt: string; status: string; userId: string; userName: string; userBranch: string | null };
type Employee = { id: string; name: string; branch: string | null; jobGroup: string | null; role: string };

const statusLabel: Record<string, string> = { active: "사용 중", suspended: "멈춤", expired: "만료", revoked: "꺼짐" };

export default function AdminApiKeysPage() {
  const [allowed, setAllowed] = useState<AllowedUser[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [employees, setEmployees] = useState<Employee[] | null>(null); // null = 아직 못 받음(실패 포함)
  const [q, setQ] = useState("");
  const load = useCallback(() => {
    fetch("/api/admin/api-keys").then((r) => r.json()).then((d) => { setAllowed(d.allowed || []); setKeys(d.keys || []); }).catch(() => {});
  }, []);
  useEffect(() => { load(); fetch("/api/employees?includeAdmins=true").then((r) => r.json()).then((d) => setEmployees(d.employees || [])).catch(() => {}); }, [load]);

  async function setAllow(userId: string, on: boolean) {
    const res = await fetch("/api/admin/api-keys/allow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId, allowed: on }) });
    if (!res.ok) { toast.error("바꾸지 못했습니다."); return; }
    toast.success(on ? "발급을 허용했습니다. 본인 환경설정에 'AI 연결 키' 탭이 생깁니다." : "허용을 해제했습니다. 그 사람의 키는 즉시 통하지 않습니다.");
    load();
  }
  async function revoke(k: KeyRow) {
    if (!confirm(`${k.userName} 님의 「${k.name}」 키를 끌까요? 본인에게 봇 DM 으로 알립니다.`)) return;
    const res = await fetch(`/api/admin/api-keys/${k.id}`, { method: "DELETE" });
    if (!res.ok) { toast.error("끄지 못했습니다."); return; }
    toast.success("껐습니다."); load();
  }
  const allowedIds = new Set(allowed.map((a) => a.id));
  const candidates = q.trim() && employees ? employees.filter((e) => !allowedIds.has(e.id) && (e.name.includes(q.trim()) || (e.branch || "").includes(q.trim()))).slice(0, 8) : [];

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><KeyRound className="text-indigo-600" />API 키</h1>
        <p className="text-sm text-gray-500 mt-1">직원이 AI·프로그램으로 자료제출·채팅을 쓰게 하는 개인 키. 허용한 사람만 본인 환경설정에서 키를 만들 수 있습니다. <a href="/api/v1/docs" target="_blank" rel="noreferrer" className="text-indigo-600 inline-flex items-center gap-0.5"><ExternalLink size={12} />사용 안내</a></p>
      </div>

      <Card><CardContent className="pt-6 space-y-3">
        <p className="font-medium text-sm">발급 허용 ({allowed.length}명)</p>
        <div className="flex flex-wrap gap-2">
          {allowed.map((u) => (
            <span key={u.id} className="inline-flex items-center gap-2 border rounded-full pl-3 pr-1 py-0.5 text-sm bg-white">
              {u.name} <span className="text-xs text-gray-500">{[u.branch, u.jobGroup].filter(Boolean).join(" ")}</span>
              <button type="button" onClick={() => setAllow(u.id, false)} className="text-xs text-red-600 px-2 py-0.5 rounded-full hover:bg-red-50">해제</button>
            </span>
          ))}
          {!allowed.length && <span className="text-sm text-gray-400">아직 허용한 사람이 없습니다. 시범 2~3명으로 시작하는 것을 권합니다.</span>}
        </div>
        <div className="max-w-sm">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·지점으로 찾아 허용 추가" />
          {/* 검색 결과는 카드 안에 그대로 펼친다 — 띄우면(absolute) 카드 경계에 잘려 안 보였다(디렉터 9/13) */}
          {q.trim() && (
            <div className="mt-1 w-full bg-white border rounded-md divide-y">
              {candidates.map((e) => (
                <button key={e.id} type="button" onClick={() => { setAllow(e.id, true); setQ(""); }} className="w-full text-left px-3 py-2 text-sm hover:bg-indigo-50 flex items-center justify-between gap-2">
                  <span>{e.name} <span className="text-xs text-gray-500">{[e.branch, e.jobGroup, e.role === "ADMIN" ? "본부" : e.role === "MANAGER" ? "원장" : ""].filter(Boolean).join(" · ")}</span></span>
                  <span className="text-xs text-indigo-600 shrink-0">허용 추가</span>
                </button>
              ))}
              {!candidates.length && <p className="px-3 py-2 text-xs text-gray-400">{employees === null ? "직원 목록을 불러오지 못했습니다. 새로고침해주세요." : "일치하는 직원이 없습니다(이미 허용된 사람은 위 목록에 있습니다)."}</p>}
            </div>
          )}
        </div>
      </CardContent></Card>

      <OrgKeyCard keys={keys.filter((k) => k.kind === "ORG")} onChanged={load} onRevoke={revoke} />

      <Card><CardContent className="pt-6 space-y-3">
        <p className="font-medium text-sm">직원 개인 키 ({keys.filter((k) => k.kind !== "ORG").length}개)</p>
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-gray-50 text-gray-600"><tr><th className="text-left p-2">직원</th><th className="text-left p-2">용도</th><th className="text-left p-2">권한</th><th className="text-left p-2">상태</th><th className="text-left p-2">마지막 사용</th><th className="text-left p-2">만료</th><th className="p-2"></th></tr></thead>
            <tbody>
              {keys.filter((k) => k.kind !== "ORG").map((k) => (
                <tr key={k.id} className={`border-t ${k.status === "revoked" || k.status === "expired" ? "opacity-50" : ""}`}>
                  <td className="p-2">{k.userName} <span className="text-gray-400">{k.userBranch ?? ""}</span></td>
                  <td className="p-2">{k.name} <span className="text-gray-400">cbt_pk_{k.prefix}…</span></td>
                  <td className="p-2">{k.scopes.join(", ")}{k.channelIds.length ? ` · 방 ${k.channelIds.length}` : ""}</td>
                  <td className="p-2">{statusLabel[k.status] ?? k.status}{k.suspendReason ? ` (${k.suspendReason})` : ""}</td>
                  <td className="p-2">{k.lastUsedAt ? `${format(new Date(k.lastUsedAt), "M/d HH:mm")} ${k.lastUsedIp ?? ""}` : "-"}</td>
                  <td className="p-2">{format(new Date(k.expiresAt), "yyyy-MM-dd")}</td>
                  <td className="p-2 text-right">{(k.status === "active" || k.status === "suspended") && <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600" onClick={() => revoke(k)}><Power size={12} />끄기</Button>}</td>
                </tr>
              ))}
              {!keys.some((k) => k.kind !== "ORG") && <tr><td colSpan={7} className="p-4 text-center text-gray-400">만들어진 키가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}

// 회사 연동 키 — 큐브마케팅 같은 외부 프로그램용. 범위는 마케팅 자료 읽기·발행 결과뿐. 원문은 발급 직후 한 번만.
const ORG_SCOPE_OPTS = [
  { id: "marketing:read", label: "마케팅 자료 읽기", hint: "지점이 올린 마케팅 자료·파일 가져가기" },
  { id: "marketing:publish", label: "발행 결과 되돌려주기", hint: "블로그 발행 주소를 기록하고 올린 직원에게 알림" },
];
function OrgKeyCard({ keys, onChanged, onRevoke }: { keys: KeyRow[]; onChanged: () => void; onRevoke: (k: KeyRow) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("큐브마케팅 블로그 발행");
  const [scopes, setScopes] = useState<string[]>(["marketing:read", "marketing:publish"]);
  const [ttl, setTtl] = useState("365");
  const [saving, setSaving] = useState(false);
  const [secret, setSecret] = useState<{ raw: string; name: string } | null>(null);
  async function create() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/api-keys/org", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, scopes, ttlDays: Number(ttl) }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "발급하지 못했습니다."); return; }
      setSecret({ raw: d.secret, name }); setOpen(false); onChanged();
    } finally { setSaving(false); }
  }
  return (
    <Card><CardContent className="pt-6 space-y-3">
      <div className="flex items-center gap-2">
        <p className="font-medium text-sm">회사 연동 키 ({keys.length}개)</p>
        <span className="text-xs text-gray-500">큐브마케팅 등 외부 프로그램이 마케팅 자료를 가져가고 발행 결과를 돌려주는 용도. 발급한 관리자가 강등·퇴사하거나 비밀번호가 초기화되면 키가 꺼지고 본부에 봇 DM 이 갑니다.</span>
        <Button size="sm" className="ml-auto gap-1 bg-indigo-600 hover:bg-indigo-700" onClick={() => setOpen(true)}><KeyRound size={14} />연동 키 발급</Button>
      </div>
      {secret && (
        <div className="border border-amber-300 bg-amber-50 rounded-lg p-3 text-sm space-y-2">
          <p className="font-medium text-amber-800">「{secret.name}」 연동 키입니다. 지금 한 번만 보입니다 — 큐브마케팅 쪽에 안전하게 전달하고 여기서는 닫으세요.</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all text-xs bg-white border rounded px-2 py-1.5">{secret.raw}</code>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(secret.raw).then(() => toast.success("복사했습니다.")).catch(() => toast.error("직접 선택해 복사해주세요.")); }}>복사</Button>
          </div>
          <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSecret(null)}>전달했습니다, 닫기</Button>
        </div>
      )}
      {keys.length > 0 && (
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-xs min-w-[640px]">
            <thead className="bg-gray-50 text-gray-600"><tr><th className="text-left p-2">용도</th><th className="text-left p-2">발급자</th><th className="text-left p-2">범위</th><th className="text-left p-2">상태</th><th className="text-left p-2">마지막 사용</th><th className="text-left p-2">만료</th><th className="p-2"></th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={`border-t ${k.status === "revoked" || k.status === "expired" ? "opacity-50" : ""}`}>
                  <td className="p-2">{k.name} <span className="text-gray-400">cbt_pk_{k.prefix}…</span></td>
                  <td className="p-2">{k.userName}</td>
                  <td className="p-2">{k.scopes.join(", ")}</td>
                  <td className="p-2">{statusLabel[k.status] ?? k.status}{k.suspendReason ? ` (${k.suspendReason})` : ""}</td>
                  <td className="p-2">{k.lastUsedAt ? `${format(new Date(k.lastUsedAt), "M/d HH:mm")} ${k.lastUsedIp ?? ""}` : "-"}</td>
                  <td className="p-2">{format(new Date(k.expiresAt), "yyyy-MM-dd")}</td>
                  <td className="p-2 text-right">{(k.status === "active" || k.status === "suspended") && <Button size="sm" variant="outline" className="h-7 text-xs gap-1 text-red-600" onClick={() => onRevoke(k)}><Power size={12} />끄기</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </CardContent></Card>
  );
}
