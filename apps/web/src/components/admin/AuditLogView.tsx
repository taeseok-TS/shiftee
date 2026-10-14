"use client";

// 변경 로그 화면 본문(QA76 #66 후속, 2026-10-14 디렉터 결정) — 업무 변경(모든 관리자) / 시스템·보안(최고관리자 전용) 두 탭.
// 검색은 서버에서(행위자·대상·내용·작업 코드), 「더 보기」는 마지막 줄의 시각|id 를 커서로 이어 받는다.
import { useCallback, useEffect, useRef, useState } from "react";
import { Lock, Search } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { auditLabel, type AuditScope } from "@/lib/audit-labels";

type Row = { id: string; actorName: string; action: string; targetType: string | null; targetName: string | null; detail: string | null; createdAt: string };

const fmt = (s: string) => {
  const d = new Date(s);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function AuditLogView({ isSuper }: { isSuper: boolean }) {
  const [scope, setScope] = useState<AuditScope>("work");
  const [q, setQ] = useState("");
  const [applied, setApplied] = useState("");   // 실제로 서버에 보낸 검색어
  const [rows, setRows] = useState<Row[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);   // 늦게 온 응답이 새 목록을 덮지 않게

  const load = useCallback(async (sc: AuditScope, query: string, before?: string) => {
    const my = ++seq.current;
    setLoading(true); setError(null);
    if (!before) { setRows([]); setHasMore(false); }   // 탭·검색이 바뀌면 이전 표가 새 제목 아래 잠깐 보이지 않게 비운다
    try {
      const u = new URLSearchParams({ scope: sc });
      if (query) u.set("q", query);
      if (before) u.set("before", before);
      const res = await fetch(`/api/admin/audit?${u.toString()}`);
      const d = await res.json().catch(() => ({}));
      if (my !== seq.current) return;
      if (!res.ok) {
        if (before) toast.error(d.error || "더 불러오지 못했습니다. 다시 눌러 주세요.");   // 받은 것은 그대로 두고 버튼도 남긴다
        else { setError(d.error || "불러오지 못했습니다."); setHasMore(false); }
        return;
      }
      setRows((prev) => (before ? [...prev, ...(d.logs || [])] : d.logs || []));
      setHasMore(!!d.hasMore);
    } catch {
      if (my !== seq.current) return;
      if (before) toast.error("서버에 연결하지 못했습니다. 다시 눌러 주세요.");
      else setError("서버에 연결하지 못했습니다.");
    } finally { if (my === seq.current) setLoading(false); }
  }, []);

  useEffect(() => {
    // 탭·검색어가 바뀌면 처음부터 다시 — load 가 바로 로딩 표시를 켠다(사이드바와 같은 예외)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(scope, applied);
  }, [scope, applied, load]);

  const search = () => setApplied(q.trim());
  const last = rows[rows.length - 1];

  return (
    <div className="space-y-4">
      {isSuper && (
        <div className="flex gap-1 border-b">
          {([["work", "업무 변경"], ["system", "시스템·보안"]] as [AuditScope, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setScope(k)} aria-current={scope === k ? "page" : undefined}
              className={scope === k ? "px-4 py-2 text-sm font-semibold text-indigo-700 border-b-2 border-indigo-600 -mb-px" : "px-4 py-2 text-sm text-gray-500 hover:text-gray-800"}>
              {k === "system" && <Lock size={12} className="inline mr-1 -mt-0.5" />}{label}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-500">
        {scope === "work"
          ? "직원·휴가·근무일정·출퇴근·계약·공휴일·지점 등 운영 중 관리자가 바꾼 기록입니다. 모든 관리자가 봅니다."
          : "비밀번호 재설정·권한 설정·API 키·포털 연동·출퇴근 정책 같은 시스템·보안 기록입니다. 최고관리자만 봅니다. 로그인 실패 기록은 환경설정에 있습니다."}
      </p>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">{scope === "work" ? "업무 변경 기록" : "시스템·보안 기록"}
              <span className="ml-2 text-sm font-normal text-gray-500">· 최근 것부터 100건씩</span>
            </CardTitle>
            <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); search(); }}>
              <div className="relative">
                <Search size={14} className="absolute left-2 top-2.5 text-gray-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·내용 검색" maxLength={60}
                  className="h-9 w-56 rounded-md border pl-7 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200" aria-label="변경 로그 검색" />
              </div>
              <Button type="submit" size="sm" variant="outline" className="h-9">검색</Button>
              {applied && <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => { setQ(""); setApplied(""); }}>지우기</Button>}
            </form>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <p className="p-4 text-sm text-red-600">{error}</p>
          ) : loading && rows.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">불러오는 중…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">{applied ? `「${applied}」에 해당하는 기록이 없습니다.` : "기록된 변경 이력이 없습니다."}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-xs text-gray-500 bg-gray-50 text-left">
                    <th className="px-4 py-2 font-medium w-36">시간</th>
                    <th className="px-4 py-2 font-medium">행위자</th>
                    <th className="px-4 py-2 font-medium">작업</th>
                    <th className="px-4 py-2 font-medium">대상</th>
                    <th className="px-4 py-2 font-medium">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 align-top">
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmt(l.createdAt)}</td>
                      <td className="px-4 py-2 text-gray-900 whitespace-nowrap">{l.actorName}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className={`text-xs rounded px-2 py-0.5 ${scope === "system" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-700"}`}>{auditLabel(l.action)}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{l.targetName || "-"}</td>
                      <td className="px-4 py-2 text-gray-700 break-words">{l.detail || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && (hasMore || loading) && (
            <div className="p-3 border-t text-center">
              <Button type="button" size="sm" variant="outline" disabled={loading || !last} onClick={() => last && void load(scope, applied, `${last.createdAt}|${last.id}`)}>
                {loading ? "불러오는 중…" : "더 보기"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
