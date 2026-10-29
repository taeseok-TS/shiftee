"use client";
// 근태 › 출퇴근 현황 「지점 밖 · 위치 실패」(2026-10-27 이예지 — 「지점 안인데 지점 밖으로 뜬다」가 여러 지점에서 생기는데 본부가 누가 몇 번 실패했는지 볼 수 없었다)
//  · 출근 · 퇴근 버튼을 누른 시도마다 서버가 남긴 기록(GeofenceAttempt)을 기간 · 지점으로 걸러 본다. 기본 최근 7일 · 실패만
//  · 위 「반복 직원」(실패 2회 이상) · 「지점별」 요약, 아래 표(날짜 · 시각 · 직원 · 지점 · 거리 · 오차 · 인정 거리 · 결과 · 기기 · OS · 앱 버전), 엑셀
//  · 좌표 숫자는 없다(거리 · 오차만). 10/27 저녁 반영 전 시도는 기록이 없다(그 전은 「지점 밖 요청」 자체만 남아 있다)
import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx";
import { jobGroupLabel } from "@/lib/job-group-label";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Btn, Box, tableClass, StatusPill } from "@/components/kit";

type Row = {
  id: string; date: string; time: string; action: string; userId: string; name: string; userBranch: string | null; position: string | null;
  branch: string | null; distance: number | null; accuracy: number | null; radius: number | null; result: string;
  device: string | null; platform: string | null; appVersion: string | null;
};
type Repeat = { userId: string; name: string; branch: string | null; fails: number; days: number; lastDistance: number | null; maxAccuracy: number | null };
type ByBranch = { branch: string; fails: number; ok: number; people: number };
type Data = { from: string; to: string; rows: Row[]; repeat: Repeat[]; byBranch: ByBranch[]; branches?: string[]; truncated: boolean };

const RESULT_LABEL: Record<string, string> = { OK: "지점 안", OUTSIDE: "지점 밖 판정", NO_LOCATION: "위치 없음" };
const ymdKst = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const m = (n: number | null | undefined) => (n == null ? "—" : `${n}m`);

export default function GeofenceAttemptsBox() {
  const [branches, setBranches] = useState<string[]>([]);
  const today = ymdKst(new Date());
  const [from, setFrom] = useState(() => ymdKst(new Date(Date.now() - 6 * 86400_000)));
  const [to, setTo] = useState(today);
  const [branch, setBranch] = useState("");
  const [failOnly, setFailOnly] = useState(true);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ from, to, ...(branch ? { branch } : {}), ...(failOnly ? { fail: "1" } : {}) });
      const res = await fetch(`/api/admin/geofence-attempts?${q}`);
      const d = await res.json().catch(() => null);
      if (!res.ok) { toast.error(d?.error || "불러오지 못했습니다"); return; }
      setData(d);
      if (Array.isArray(d?.branches)) setBranches(d.branches);
    } catch { toast.error("불러오지 못했습니다"); }
    finally { setLoading(false); }
  }, [from, to, branch, failOnly]);
  useEffect(() => {
    // 효과 안에서 바로 setState 하지 않게 한 박자 뒤에(react-hooks/set-state-in-effect)
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const exportXlsx = () => {
    if (!data?.rows.length) { toast.error("내보낼 기록이 없습니다."); return; }
    const rows = data.rows.map((r) => ({
      날짜: r.date, 시각: r.time, 구분: r.action === "OUT" ? "퇴근" : "출근", 직원: r.name, 지점: r.userBranch ?? "", 직급: jobGroupLabel(r.position),
      "판정 지점": r.branch ?? "", "지점까지 거리(m)": r.distance ?? "", "위치 오차(m)": r.accuracy ?? "", "인정 거리(m)": r.radius ?? "",
      결과: RESULT_LABEL[r.result] ?? r.result, 기기: r.device ?? "", OS: r.platform ?? "", "앱 버전": r.appVersion ?? "",
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "위치 판정 시도");
    if (data.repeat.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.repeat.map((u) => ({ 직원: u.name, 지점: u.branch ?? "", "실패 횟수": u.fails, "실패한 날": u.days, "마지막 거리(m)": u.lastDistance ?? "", "최대 오차(m)": u.maxAccuracy ?? "" }))), "반복 직원");
    XLSX.writeFile(wb, `위치판정_${data.from}_${data.to}.xlsx`);
  };

  const inputClass = "rounded-[10px] border border-[#e2e8f0] bg-white px-2.5 py-1.5 text-[13px] text-[#334155]";
  const tone = (r: string) => (r === "OK" ? "done" : r === "OUTSIDE" ? "rej" : "wait") as "done" | "rej" | "wait";

  return (
    <div className="space-y-[18px]">
      <Box title="지점 밖 · 위치 실패" sub="출근 · 퇴근 버튼을 누른 시도마다 남긴 위치 판정 기록 — 거리 · 오차 · 기기(좌표 숫자는 남기지 않음). 10/27 저녁 이후 시도부터"
        right={<Btn onClick={exportXlsx} disabled={!data?.rows.length}><Download size={14} />엑셀</Btn>}>
        <p className="px-6 pt-3 text-[12.5px] text-[#94a3b8]">앱은 첫 판정이 지점 밖이면 위치를 다시 잡아 한 번 더 보냅니다 — 한 번 눌러도 「지점 밖 판정 → 지점 안」 두 줄이 남을 수 있습니다.</p>
        <div className="flex flex-wrap items-center gap-2 px-6 py-3 text-[13px]">
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputClass} aria-label="시작" />
          <span className="text-[#94a3b8]">~</span>
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className={inputClass} aria-label="끝" />
          <select value={branch} onChange={(e) => setBranch(e.target.value)} className={inputClass} aria-label="지점">
            <option value="">지점: 전체</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-[#334155]"><input type="checkbox" checked={failOnly} onChange={(e) => setFailOnly(e.target.checked)} />실패만</label>
          {loading && <span className="text-[#94a3b8]">불러오는 중…</span>}
          {data?.truncated && <span className="text-[#dc2626]">2,000건까지만 — 아래 요약도 그 안에서만 센 것이니 기간을 좁혀 주세요</span>}
        </div>
        {/* 반복 직원 · 지점별 — 본부가 바로 찾을 수 있게 위에 */}
        <div className="grid gap-4 px-6 pb-4 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-[#596578]">반복 실패 직원 <span className="tabular-nums">{data?.repeat.length ?? 0}</span> <span className="font-normal">· 기간 안 2회 이상</span></p>
            {!data?.repeat.length ? <p className="text-[13px] text-[#94a3b8]">없음</p> : (
              <ul className="space-y-1 text-[13.5px]">
                {data.repeat.slice(0, 12).map((u) => (
                  <li key={u.userId} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-semibold text-[#0f172a]">{u.name}</span><span className="text-[#596578]">{u.branch ?? ""}</span>
                    <span className="tabular-nums text-[#dc2626]">{u.fails}회 · {u.days}일</span>
                    <span className="text-[#596578]">마지막 거리 {m(u.lastDistance)} · 최대 오차 {m(u.maxAccuracy)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[13px] font-semibold text-[#596578]">지점별</p>
            {!data?.byBranch.length ? <p className="text-[13px] text-[#94a3b8]">없음</p> : (
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[13.5px] sm:grid-cols-3">
                {data.byBranch.map((b) => (
                  <li key={b.branch} className="flex items-baseline justify-between gap-2"><span className="text-[#0f172a]">{b.branch}</span><span className="tabular-nums text-[#596578]"><span className={b.fails ? "font-semibold text-[#dc2626]" : ""}>{b.fails}</span> 실패 · {b.people}명{failOnly ? "" : ` · 성공 ${b.ok}`}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className={tableClass}>
            <thead><tr><th>날짜 · 시각</th><th>직원</th><th>지점</th><th className="text-right">거리</th><th className="text-right">오차</th><th className="text-right">인정</th><th>결과</th><th>기기</th></tr></thead>
            <tbody>
              {!data ? <tr><td colSpan={8} className="text-center text-[#596578]">불러오는 중…</td></tr>
              : !data.rows.length ? <tr><td colSpan={8} className="text-center text-[#596578]">기록이 없습니다</td></tr>
              : data.rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap tabular-nums">{r.date.slice(5).replace("-", "/")} {r.time} <span className="text-[#94a3b8]">{r.action === "OUT" ? "퇴근" : "출근"}</span></td>
                  <td><span className="font-semibold text-[#0f172a]">{r.name}</span>{r.position ? <span className="ml-1 text-[12px] text-[#596578]">{jobGroupLabel(r.position)}</span> : null}</td>
                  <td>{r.userBranch ?? r.branch ?? "—"}{r.branch && r.userBranch && r.branch !== r.userBranch ? <span className="ml-1 text-[12px] text-[#596578]">(판정 {r.branch})</span> : null}</td>
                  <td className={`text-right tabular-nums ${r.distance != null && r.radius != null && r.distance > r.radius ? "font-semibold text-[#dc2626]" : ""}`}>{m(r.distance)}</td>
                  <td className={`text-right tabular-nums ${r.accuracy != null && r.accuracy > 100 ? "font-semibold text-[#d97706]" : ""}`}>{m(r.accuracy)}</td>
                  <td className="text-right tabular-nums text-[#596578]">{m(r.radius)}</td>
                  <td><StatusPill tone={tone(r.result)}>{RESULT_LABEL[r.result] ?? r.result}</StatusPill></td>
                  <td className="whitespace-nowrap text-[12.5px] text-[#596578]">{[r.platform, r.appVersion, r.device].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
    </div>
  );
}
