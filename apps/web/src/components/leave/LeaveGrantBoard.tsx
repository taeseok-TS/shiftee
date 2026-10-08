"use client";

// 휴가 종류별 잔여(2026-10-08 QA76 #50 #56) — 본부만. 기준일까지 직원별 보상휴가·대체휴일 부여/사용/잔여,
// 부여 내역(근거 근무일·사유)·사용 내역, 본부 수동 조정(±, 사유 필수), 자동 부여 점검을 지금 돌리기.
// 직원 화면에는 넣지 않는다(#50). 잔여가 모자라도 신청은 막지 않는다(본부 답변 #19).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { RefreshCw, ChevronDown, ChevronRight, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

const GROUPS = ["보상휴가", "대체휴일"] as const;
type Group = (typeof GROUPS)[number];
type Row = {
  userId: string; empNo: number | null; name: string; branch: string | null; department: string | null;
  groups: Record<Group, { granted: number; used: number; remaining: number }>;
  grants: { id: string; group: string; days: number; workDate: string | null; source: string; note: string; createdAt: string }[];
  uses: { id: string; group: Group; label: string; startDate: string; endDate: string; days: number }[];
};
const todayYmd = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const empNoText = (n: number | null) => (n == null ? "" : String(n).padStart(5, "0"));
const d = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);

export default function LeaveGrantBoard() {
  const [asOf, setAsOf] = useState(todayYmd);
  const [inclAdmins, setInclAdmins] = useState(false);
  const [inclTest, setInclTest] = useState(false);
  const [onlyActive, setOnlyActive] = useState(true);   // 부여·사용이 있는 직원만
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [adjust, setAdjust] = useState<{ userId: string; group: Group; days: string; note: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const seq = useRef(0);   // 기준일·체크를 빨리 바꾸면 늦게 온 옛 응답이 새 표를 덮지 않게

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const p = new URLSearchParams({ asOf });
      if (inclAdmins) p.set("includeAdmins", "true");
      if (inclTest) p.set("includeTest", "true");
      const res = await fetch(`/api/leave/grants?${p}`);
      const data = await res.json().catch(() => ({}));
      if (my !== seq.current) return;
      if (!res.ok) { toast.error(data.error || "불러오지 못했습니다."); setRows([]); return; }
      setRows(data.rows || []);
    } catch { if (my === seq.current) { toast.error("네트워크 오류로 불러오지 못했습니다."); setRows([]); } }
    finally { if (my === seq.current) setLoading(false); }
  }, [asOf, inclAdmins, inclTest]);
  useEffect(() => { const t = setTimeout(load, 0); return () => clearTimeout(t); }, [load]);

  const shown = useMemo(() => {
    if (!rows) return [];
    const k = q.trim();
    return rows
      .filter((r) => !onlyActive || GROUPS.some((g) => r.groups[g].granted !== 0 || r.groups[g].used !== 0))
      .filter((r) => !k || [r.name, empNoText(r.empNo), r.branch ?? "", r.department ?? ""].some((v) => v.includes(k)));
  }, [rows, onlyActive, q]);

  // 자동 부여 점검 — 올해 1/1부터 기준일까지(매일 밤 점검과 같은 계산). 5/1·지정 공휴일 근무 기록을 다시 읽는다
  const runCheck = async () => {
    if (running) return;
    setRunning(true);
    try {
      const res = await fetch("/api/leave/grants/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from: `${asOf.slice(0, 4)}-01-01`, to: asOf }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "점검하지 못했습니다."); return; }
      toast.success(`${data.from}~${data.to} 점검 — 부여 ${data.created}건 · 갱신 ${data.updated}건 · 회수 ${data.revoked}건`);
      load();
    } finally { setRunning(false); }
  };

  const saveAdjust = async () => {
    if (!adjust || saving) return;
    const days = Number(adjust.days);
    if (!Number.isFinite(days) || days === 0) { toast.error("일수를 넣어 주세요(차감은 음수)."); return; }
    if (!adjust.note.trim()) { toast.error("사유를 적어 주세요."); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/leave/grants", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: adjust.userId, group: adjust.group, days, note: adjust.note.trim() }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "조정하지 못했습니다."); return; }
      toast.success("조정했습니다.");
      setAdjust(null);
      load();
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">기준일</div>
              <Input type="date" value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} className="h-8 w-40" />
            </div>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 h-8 cursor-pointer select-none">
              <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />부여·사용 있는 직원만
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 h-8 cursor-pointer select-none">
              <input type="checkbox" checked={inclAdmins} onChange={(e) => setInclAdmins(e.target.checked)} />관리자 포함
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 h-8 cursor-pointer select-none">
              <input type="checkbox" checked={inclTest} onChange={(e) => setInclTest(e.target.checked)} />통계 제외 지점(본부·테스트) 포함
            </label>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·사번·지점 검색" className="h-8 w-44" />
            <Button variant="outline" size="sm" className="gap-1 ml-auto" onClick={runCheck} disabled={running} title="올해 1/1부터 기준일까지 5/1·지정 공휴일 근무 기록을 다시 읽어 자동 부여를 맞춥니다">
              <RefreshCw size={13} className={running ? "animate-spin" : ""} />{running ? "점검 중…" : "자동 부여 점검(올해)"}
            </Button>
          </div>
          <p className="text-xs text-gray-400 leading-relaxed">
            · 보상휴가: 5/1 근로자의 날 근무 기록(휴게 제외) — 8시간까지 ×1.5, 넘는 시간 ×2, 8시간 = 1일 (8h → 1.5일, 4h → 0.75일, 10h → 2일)<br />
            · 대체휴일: 공휴일 관리에서 「대체휴무 부여」로 지정한 공휴일의 평일 근무 기록 → 1일<br />
            · 매일 밤 최근 45일을 다시 계산합니다(출퇴근이 고쳐지면 갱신, 지워지면 회수). 잔여 = 부여 − 승인된 사용. 잔여가 모자라도 신청은 막지 않습니다.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-gray-500 bg-gray-50/60 text-left">
                <th className="px-3 py-2.5 font-medium w-6"></th>
                <th className="px-3 py-2.5 font-medium">직원</th>
                <th className="px-3 py-2.5 font-medium">지점</th>
                {GROUPS.map((g) => (
                  <th key={g} className="px-3 py-2.5 font-medium text-right" colSpan={3}>{g} <span className="font-normal text-gray-400">(부여 / 사용 / 잔여)</span></th>
                ))}
                <th className="px-3 py-2.5 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows === null || loading ? (
                <tr><td colSpan={10} className="py-8 text-center text-gray-400">불러오는 중…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={10} className="py-8 text-center text-gray-400">{onlyActive ? "부여·사용 기록이 있는 직원이 없습니다. (「부여·사용 있는 직원만」을 끄면 전원이 보입니다)" : "직원이 없습니다."}</td></tr>
              ) : shown.map((r) => {
                const isOpen = open === r.userId;
                return (
                  <FragmentRow key={r.userId} r={r} isOpen={isOpen} onToggle={() => setOpen(isOpen ? null : r.userId)}
                    onAdjust={(g) => setAdjust({ userId: r.userId, group: g, days: "", note: "" })} />
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {adjust && (
        <Card className="border-indigo-200">
          <CardContent className="pt-4 space-y-2">
            <p className="text-sm font-medium flex items-center gap-1"><PlusCircle size={14} />수동 조정 — {rows?.find((r) => r.userId === adjust.userId)?.name} · {adjust.group}</p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <div className="text-xs text-gray-500 mb-1">일수 (차감은 음수, 예: 1.5 / -0.5)</div>
                <Input value={adjust.days} onChange={(e) => setAdjust({ ...adjust, days: e.target.value })} className="h-8 w-32" placeholder="1.5" />
              </div>
              <div className="flex-1 min-w-[240px]">
                <div className="text-xs text-gray-500 mb-1">사유 (필수 — 이력에 남습니다)</div>
                <Input value={adjust.note} onChange={(e) => setAdjust({ ...adjust, note: e.target.value })} className="h-8" placeholder="예: 시프티 잔여 이관 / 수당 지급으로 차감" />
              </div>
              <Button size="sm" className="h-8" onClick={saveAdjust} disabled={saving}>{saving ? "저장 중…" : "저장"}</Button>
              <Button size="sm" variant="outline" className="h-8" onClick={() => setAdjust(null)}>취소</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function FragmentRow({ r, isOpen, onToggle, onAdjust }: { r: Row; isOpen: boolean; onToggle: () => void; onAdjust: (g: Group) => void }) {
  return (
    <>
      <tr className="border-b hover:bg-gray-50/70">
        <td className="px-3 py-2.5 text-gray-400 cursor-pointer" onClick={onToggle}>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td className="px-3 py-2.5">
          <p className="font-medium text-gray-900">{r.name}</p>
          <p className="text-xs text-gray-400">{empNoText(r.empNo)}{r.department ? ` · ${r.department}` : ""}</p>
        </td>
        <td className="px-3 py-2.5 text-gray-600">{r.branch || "-"}</td>
        {GROUPS.map((g) => (
          <GroupCells key={g} v={r.groups[g]} />
        ))}
        <td className="px-3 py-2.5 whitespace-nowrap">
          {GROUPS.map((g) => (
            <button key={g} type="button" className="text-xs text-indigo-600 hover:underline mr-2" onClick={() => onAdjust(g)}>{g} 조정</button>
          ))}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b bg-gray-50/40">
          <td></td>
          <td colSpan={9} className="px-3 py-3">
            <div className="grid md:grid-cols-2 gap-4 text-xs">
              <div>
                <p className="font-medium text-gray-700 mb-1">부여 내역 ({r.grants.length})</p>
                {r.grants.length === 0 ? <p className="text-gray-400">없음</p> : (
                  <ul className="space-y-0.5">
                    {r.grants.map((g) => (
                      <li key={g.id} className="text-gray-600">
                        <span className="font-mono text-gray-500">{g.workDate ?? kst(g.createdAt)}</span> · {g.group} <b className={g.days < 0 ? "text-red-600" : "text-emerald-700"}>{g.days > 0 ? "+" : ""}{d(g.days)}일</b>
                        <span className="ml-1 px-1 rounded bg-gray-100 text-gray-500">{g.source === "AUTO" ? "자동" : "수동"}</span> — {g.note}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <p className="font-medium text-gray-700 mb-1">사용 내역 ({r.uses.length})</p>
                {r.uses.length === 0 ? <p className="text-gray-400">없음</p> : (
                  <ul className="space-y-0.5">
                    {r.uses.map((u) => (
                      <li key={u.id} className="text-gray-600"><span className="font-mono text-gray-500">{u.startDate === u.endDate ? u.startDate : `${u.startDate} ~ ${u.endDate}`}</span> · {u.label} <b>{d(u.days)}일</b></li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function GroupCells({ v }: { v: { granted: number; used: number; remaining: number } }) {
  return (
    <>
      <td className="px-3 py-2.5 text-right text-gray-600">{d(v.granted)}</td>
      <td className="px-3 py-2.5 text-right text-gray-600">{d(v.used)}</td>
      <td className={`px-3 py-2.5 text-right font-semibold ${v.remaining < 0 ? "text-red-600" : "text-gray-900"}`}>{d(v.remaining)}</td>
    </>
  );
}
