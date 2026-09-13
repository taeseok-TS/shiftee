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
type KeyRow = { id: string; name: string; prefix: string; scopes: string[]; channelIds: string[]; expiresAt: string; lastUsedAt: string | null; lastUsedIp: string | null; suspendedAt: string | null; suspendReason: string | null; revokedAt: string | null; createdAt: string; status: string; userId: string; userName: string; userBranch: string | null };
type Employee = { id: string; name: string; branch: string | null; jobGroup: string | null; role: string };

const statusLabel: Record<string, string> = { active: "사용 중", suspended: "멈춤", expired: "만료", revoked: "꺼짐" };

export default function AdminApiKeysPage() {
  const [allowed, setAllowed] = useState<AllowedUser[]>([]);
  const [keys, setKeys] = useState<KeyRow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
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
  const candidates = q.trim() ? employees.filter((e) => !allowedIds.has(e.id) && (e.name.includes(q.trim()) || (e.branch || "").includes(q.trim()))).slice(0, 8) : [];

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
              {!candidates.length && <p className="px-3 py-2 text-xs text-gray-400">{employees.length ? "일치하는 직원이 없습니다(이미 허용된 사람은 위 목록에 있습니다)." : "직원 목록을 불러오는 중…"}</p>}
            </div>
          )}
        </div>
      </CardContent></Card>

      <Card><CardContent className="pt-6 space-y-3">
        <p className="font-medium text-sm">전체 키 ({keys.length}개)</p>
        <div className="overflow-x-auto border rounded">
          <table className="w-full text-xs min-w-[720px]">
            <thead className="bg-gray-50 text-gray-600"><tr><th className="text-left p-2">직원</th><th className="text-left p-2">용도</th><th className="text-left p-2">권한</th><th className="text-left p-2">상태</th><th className="text-left p-2">마지막 사용</th><th className="text-left p-2">만료</th><th className="p-2"></th></tr></thead>
            <tbody>
              {keys.map((k) => (
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
              {!keys.length && <tr><td colSpan={7} className="p-4 text-center text-gray-400">만들어진 키가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </div>
  );
}
