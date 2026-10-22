"use client";
// 인사 › 연봉(2026-10-22 디렉터) — 본부 연봉이력(RAW)을 엑셀로 올려 두고, 사람마다 이전 연봉 → 이번 연봉, 인상 금액 · 인상률을 본다.
//  · 들어갈 때 로그인 비밀번호를 한 번 더(30분) — 숫자는 열쇠가 있어야 서버가 준다(lib/salary-access). 「잠그기」로 바로 닫는다
//  · 인상 대상자 = 고른 해에 시작한 계약이 있고 그 앞 계약도 있는 사람. 이번 = 그 해에 시작한 마지막 계약, 이전 = 그 바로 앞 계약
//    (「전체」 탭에서 그 해 계약이 없는 사람은 최신 계약과 그 앞 계약)
//  · 공통 부품(components/kit) — 숫자는 색칠하지 않는다(디자인 통일 원칙)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Wallet, Upload, History } from "lucide-react";
import { toast } from "sonner";
import { PageHead, Btn, btnClass, Box, Tiles, Tile, PillTabs, FilterRow, inputClass, tableClass, Cell2, StatusPill, MoreMenu } from "@/components/kit";
import { ReauthPasswordInput } from "@/components/ui/reauth-password-input";

type Hist = { id: string; startDate: string; endDate: string | null; amount: number; jobTitle: string | null; renewed: boolean };
type Person = { empNo: number; name: string; sheetName: string; jobTitle: string | null; branch: string | null; matched: boolean; active: boolean; latest: Hist; prev: Hist | null; history: Hist[] };
type Preview = { sheet: string; rows: number; people: number; matchedPeople: number; added: number; changed: number; same: number; errors: { line: number; message: string }[]; errorCount: number };

const won = (n: number) => n.toLocaleString("ko-KR");
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${won(Math.abs(n))}`;
const kstYear = () => new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();

export default function SalaryScreen() {
  const [phase, setPhase] = useState<"loading" | "locked" | "ready">("loading");
  const [people, setPeople] = useState<Person[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"all" | "raise">("raise");
  const [year, setYear] = useState(() => String(kstYear()));
  const [q, setQ] = useState("");
  const [job, setJob] = useState("");
  const [branch, setBranch] = useState("");
  const [withResigned, setWithResigned] = useState(false);
  const [sort, setSort] = useState<"emp" | "rate" | "amount">("rate");
  const [open, setOpen] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = useRef<File | null>(null);

  // 목록 받기 — 열쇠가 없으면(LOCKED) 비밀번호 화면으로
  const fetchSalary = useCallback(() => fetch("/api/salary", { cache: "no-store" })
    .then(async (res) => ({ res, d: await res.json().catch(() => ({})) }))
    .catch(() => null), []);
  const apply = useCallback((r: Awaited<ReturnType<typeof fetchSalary>>) => {
    if (!r) { toast.error("불러오지 못했습니다."); setPhase("locked"); return; }
    const { res, d } = r;
    if (res.status === 403 && d.code === "LOCKED") { setPhase("locked"); setPeople([]); return; }
    if (!res.ok) { toast.error(d.error || "불러오지 못했습니다."); setPhase("locked"); return; }
    setPeople(d.people || []); setUpdatedAt(d.updatedAt || null); setExpiresAt(d.expiresAt || null); setPhase("ready");
  }, []);
  const load = useCallback(async () => apply(await fetchSalary()), [apply, fetchSalary]);
  useEffect(() => { fetchSalary().then(apply); }, [fetchSalary, apply]);
  // 열쇠가 끝나는 시각에 화면도 잠근다 — 탭을 열어 둔 공용 PC 에 숫자가 남지 않게(검증)
  useEffect(() => {
    if (phase !== "ready" || !expiresAt) return;
    const lockNow = () => { setPeople([]); setPreview(null); setPhase("locked"); toast.info("30분이 지나 연봉 화면을 잠갔습니다."); };
    const t = setTimeout(lockNow, Math.max(0, expiresAt - Date.now()));
    // 노트북을 재운 동안 시계가 멈출 수 있다 — 화면이 다시 보일 때도 확인
    const onVis = () => { if (document.visibilityState === "visible" && Date.now() >= expiresAt) lockNow(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onVis); };
  }, [phase, expiresAt]);

  async function unlock() {
    if (!pw || busy) return;
    setBusy(true);
    const res = await fetch("/api/salary/unlock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }) }).catch(() => null);
    setBusy(false); setPw("");
    const d = await res?.json().catch(() => ({}));
    if (!res?.ok) { toast.error(d?.error || "확인하지 못했습니다."); return; }
    await load();
  }
  async function lock() {
    await fetch("/api/salary/unlock", { method: "DELETE" }).catch(() => {});
    setPeople([]); setPreview(null); setPhase("locked");
  }

  // 잘못 들어간 이력 한 줄 지우기(엑셀 오타 등) — 한 번 더 확인
  async function removeRow(p: Person, h: Hist) {
    if (!confirm(`${p.name} — ${h.startDate} 시작 계약(${won(h.amount)}원) 줄을 지울까요?\n잘못 들어간 줄일 때만 지우세요. 변경 로그에 남습니다.`)) return;
    const res = await fetch(`/api/salary?id=${encodeURIComponent(h.id)}`, { method: "DELETE" }).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    if (res?.status === 403 && d?.code === "LOCKED") { setPhase("locked"); return; }
    if (!res?.ok) { toast.error(d?.error || "지우지 못했습니다."); return; }
    toast.success("지웠습니다."); await load();
  }

  async function sendFile(file: File, apply: boolean) {
    const fd = new FormData(); fd.append("file", file);
    setBusy(true);
    const res = await fetch(`/api/salary/import${apply ? "?apply=1" : ""}`, { method: "POST", body: fd }).catch(() => null);
    setBusy(false);
    const d = await res?.json().catch(() => ({}));
    if (res?.status === 403 && d?.code === "LOCKED") { toast.error("30분이 지나 잠겼습니다. 비밀번호를 다시 넣어 주세요."); setPhase("locked"); return; }
    if (!res?.ok) { toast.error(d?.error || "올리지 못했습니다."); return; }
    if (apply) { toast.success(`반영했습니다 — 새 ${d.added} · 바뀜 ${d.changed} · 같음 ${d.same}`); setPreview(null); pending.current = null; await load(); }
    else setPreview(d);
  }

  // 고를 수 있는 해 = 이력에 있는 모든 계약 시작 해(최신 계약 해만 쓰면 모두 재계약한 뒤 지난해를 못 골랐다, 재검증)
  const years = useMemo(() => [...new Set(people.flatMap((p) => p.history.map((h) => h.startDate.slice(0, 4))))].sort().reverse(), [people]);
  const jobs = useMemo(() => [...new Set(people.map((p) => p.jobTitle).filter(Boolean) as string[])].sort(), [people]);
  const branches = useMemo(() => [...new Set(people.map((p) => p.branch).filter(Boolean) as string[])].sort(), [people]);
  // 고른 해 기준 짝 — 그 해에 시작한 마지막 계약(이번)과 그 바로 앞 계약(이전). 그 해 계약이 없으면 최신·그 앞(history 는 최신 먼저)
  const pairOf = useCallback((p: Person): { cur: Hist; prev: Hist | null; inYear: boolean } => {
    const i = p.history.findIndex((h) => h.startDate.startsWith(year));
    return i >= 0 ? { cur: p.history[i], prev: p.history[i + 1] ?? null, inYear: true } : { cur: p.history[0], prev: p.history[1] ?? null, inYear: false };
  }, [year]);
  const isTarget = useCallback((p: Person) => { const x = pairOf(p); return x.inYear && !!x.prev; }, [pairOf]);
  const base = useMemo(() => people.filter((p) => (withResigned || p.active)
    && (!job || p.jobTitle === job) && (!branch || p.branch === branch)
    && (!q.trim() || p.name.includes(q.trim()) || p.sheetName.includes(q.trim()) || String(p.empNo).includes(q.trim().replace(/^0+/, "")))), [people, withResigned, job, branch, q]);
  const targets = useMemo(() => base.filter(isTarget), [base, isTarget]);
  const rows = useMemo(() => {
    const list = tab === "raise" ? targets : base;
    const diff = (p: Person) => { const x = pairOf(p); return x.prev ? x.cur.amount - x.prev.amount : -Infinity; };
    const rate = (p: Person) => { const x = pairOf(p); return x.prev ? (x.cur.amount - x.prev.amount) / x.prev.amount : -Infinity; };
    return [...list].sort((a, b) => sort === "emp" ? a.empNo - b.empNo : sort === "rate" ? rate(b) - rate(a) : diff(b) - diff(a));
  }, [tab, targets, base, sort, pairOf]);
  const stats = useMemo(() => {
    if (!targets.length) return { avgRate: null as number | null, avgAmt: null as number | null, total: null as number | null };
    const pairs = targets.map(pairOf);
    const amts = pairs.map((x) => x.cur.amount - x.prev!.amount);
    const rates = pairs.map((x) => (x.cur.amount - x.prev!.amount) / x.prev!.amount * 100);
    return { avgRate: Math.round(rates.reduce((a, b) => a + b, 0) / rates.length * 10) / 10, avgAmt: Math.round(amts.reduce((a, b) => a + b, 0) / amts.length), total: amts.reduce((a, b) => a + b, 0) };
  }, [targets, pairOf]);

  if (phase === "loading") return <p className="p-6 text-sm text-gray-400">불러오는 중…</p>;

  if (phase === "locked") return (
    <div>
      <PageHead crumb="인사 › 연봉" title="연봉" />
      <Box icon={<Lock />} title="비밀번호 확인" sub="연봉은 민감한 정보라 들어갈 때마다 로그인 비밀번호를 한 번 더 확인합니다(30분 동안 열림)">
        <form className="flex flex-wrap items-center gap-2 px-6 py-5" onSubmit={(e) => { e.preventDefault(); void unlock(); }}>
          <ReauthPasswordInput plain value={pw} onChange={(e) => setPw(e.target.value)} placeholder="로그인 비밀번호" className={`${inputClass} w-64`} aria-label="로그인 비밀번호" />
          <button type="submit" disabled={!pw || busy} className={btnClass("primary")}>{busy ? "확인 중…" : "열기"}</button>
          <span className="w-full text-[12.5px] text-[#596578]">5번 틀리면 15분 동안 잠깁니다. 열람 기록은 변경 로그에 남습니다.</span>
        </form>
      </Box>
    </div>
  );

  return (
    <div>
      <PageHead crumb="인사 › 연봉" title="연봉" note={updatedAt ? `자료 ${new Date(updatedAt).toLocaleDateString("ko-KR")} 반영` : "자료 없음"}>
        <Btn onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={15} />엑셀 올리기</Btn>
        <Btn onClick={lock}><Lock size={15} />잠그기</Btn>
      </PageHead>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { pending.current = f; void sendFile(f, false); } }} />

      {preview && (
        <Box icon={<Upload />} title="올릴 내용 확인" sub={`「${preview.sheet}」 탭 · ${preview.rows}줄 · ${preview.people}명(큐브티와 사번이 맞는 사람 ${preview.matchedPeople}명)`}
          right={<><Btn onClick={() => { setPreview(null); pending.current = null; }}>취소</Btn><Btn kind="primary" disabled={busy || !preview.rows} onClick={() => pending.current && void sendFile(pending.current, true)}>반영</Btn></>}>
          <div className="space-y-1.5 px-6 py-4 text-[13.5px] text-[#334155]">
            <p>새 줄 <b>{preview.added}</b> · 바뀐 줄 <b>{preview.changed}</b> · 같은 줄 <b>{preview.same}</b> — 같은 사번·같은 시작일이면 같은 계약으로 보고 값만 고칩니다. 파일에 없는 기존 줄은 그대로 둡니다.</p>
            {preview.errorCount > 0 && (
              <div className="rounded-lg bg-[#fff1f2] px-3 py-2 text-[12.5px] text-[#be123c]">
                넣지 못하는 줄 {preview.errorCount}개{preview.errorCount > preview.errors.length ? `(앞 ${preview.errors.length}개만 보입니다)` : ""}
                <ul className="mt-1 list-disc pl-5">{preview.errors.map((e, i) => <li key={i}>{e.line}행 — {e.message}</li>)}</ul>
              </div>
            )}
          </div>
        </Box>
      )}

      {!people.length ? (
        <Box icon={<Wallet />} title="연봉 자료가 없습니다">
          <p className="px-6 py-5 text-[13.5px] text-[#596578]">본부 「연봉이력(RAW)」 시트를 엑셀(xlsx)로 내려받아 「엑셀 올리기」로 올려 주세요. 열: 사번 · 직무 · 이름 · 연봉적용기간(시작) · (끝) · 계약 연봉 · 갱신여부</p>
        </Box>
      ) : (<>
        <Box icon={<Wallet />} title={`${year}년 연봉 인상`} sub="이전 = 바로 앞 계약, 이번 = 최신 계약 · 아래 필터 기준">
          <Tiles cols={4}>
            <Tile label="인상 대상자" value={targets.length} unit="명" note={`${year}년에 새 계약이 생긴 사람`} hl active={tab === "raise"} onClick={() => setTab("raise")} />
            <Tile label="평균 인상률" value={stats.avgRate === null ? null : `${stats.avgRate > 0 ? "+" : ""}${stats.avgRate}`} unit="%" />
            <Tile label="평균 인상 금액" value={stats.avgAmt === null ? null : signed(stats.avgAmt)} unit="원" />
            <Tile label="인상 총액(연)" value={stats.total === null ? null : signed(stats.total)} unit="원" />
          </Tiles>
        </Box>
        <PillTabs value={tab} onChange={(k) => setTab(k as "all" | "raise")} tabs={[
          { key: "raise", label: "인상 대상자", count: targets.length },
          { key: "all", label: "전체", count: base.length },
        ]} />
        <Box icon={<Wallet />} title={tab === "raise" ? "인상 대상자" : "전체"} sub={`${rows.length}명`}>
          <FilterRow right={
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className={inputClass} aria-label="정렬">
              <option value="rate">인상률 높은 순</option>
              <option value="amount">인상 금액 높은 순</option>
              <option value="emp">사번 순</option>
            </select>
          }>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 사번으로 찾기" className={`${inputClass} w-48`} aria-label="찾기" />
            <select value={year} onChange={(e) => setYear(e.target.value)} className={inputClass} aria-label="인상 연도">
              {(years.includes(String(kstYear())) ? years : [String(kstYear()), ...years]).map((y) => <option key={y} value={y}>{y}년 인상</option>)}
            </select>
            <select value={job} onChange={(e) => setJob(e.target.value)} className={inputClass} aria-label="직무">
              <option value="">직무: 전체</option>
              {jobs.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
            <select value={branch} onChange={(e) => setBranch(e.target.value)} className={inputClass} aria-label="지점">
              <option value="">지점: 전체</option>
              {branches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <label className="flex items-center gap-1.5 text-[13px] text-[#475569]"><input type="checkbox" checked={withResigned} onChange={(e) => setWithResigned(e.target.checked)} />퇴사자 포함</label>
          </FilterRow>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>사번</th><th>이름</th><th className="text-right">이전 연봉</th><th className="text-right">이번 연봉</th>
                  <th className="text-right">인상 금액</th><th className="text-right">인상률</th><th>적용 시작</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={8} className="py-8 text-center text-gray-400">{tab === "raise" ? `${year}년 인상 대상자가 없습니다` : "없음"}</td></tr>
                ) : rows.flatMap((p) => {
                  const { cur, prev } = pairOf(p);
                  const d = prev ? cur.amount - prev.amount : null;
                  const r = prev && d !== null ? Math.round(d / prev.amount * 1000) / 10 : null;
                  const main = (
                    <tr key={p.empNo} className="hover:bg-[#fafbfd]">
                      <td className="tabular-nums text-[#596578]">{String(p.empNo).padStart(5, "0")}</td>
                      <td><Cell2 main={p.name} sub={[p.jobTitle, p.branch, !p.matched ? "큐브티에 없음" : !p.active ? "퇴사" : null].filter(Boolean).join(" · ") || undefined} /></td>
                      <td className="text-right tabular-nums">{prev ? won(prev.amount) : <span className="text-[#94a3b8]">—</span>}</td>
                      <td className="text-right tabular-nums font-bold text-[#0f172a]">{won(cur.amount)}</td>
                      <td className="text-right tabular-nums">{d === null ? <span className="text-[#94a3b8]">—</span> : signed(d)}</td>
                      <td className="text-right tabular-nums">{r === null ? <span className="text-[#94a3b8]">—</span> : `${r > 0 ? "+" : ""}${r}%`}</td>
                      <td className="whitespace-nowrap tabular-nums">{cur.startDate}{isTarget(p) && <> <StatusPill tone="ind">{year} 인상</StatusPill></>}</td>
                      <td className="text-right"><MoreMenu items={[{ label: open === p.empNo ? "이력 닫기" : `연봉 이력 (${p.history.length})`, onClick: () => setOpen(open === p.empNo ? null : p.empNo) }]} /></td>
                    </tr>
                  );
                  if (open !== p.empNo) return [main];
                  return [main, (
                    <tr key={`${p.empNo}-h`}>
                      <td colSpan={8} className="!bg-[#fafbfd] !py-3">
                        <p className="mb-1.5 flex items-center gap-1.5 text-[13px] font-semibold text-[#475569]"><History size={14} />{p.name} 연봉 이력</p>
                        <table className="text-[13px] [&_td]:!border-0 [&_td]:!py-1 [&_td]:!pl-0 [&_td]:!pr-6">
                          <tbody>
                            {p.history.map((h, i) => {
                              const before = p.history[i + 1];
                              const hd = before ? h.amount - before.amount : null;
                              return (
                                <tr key={h.startDate}>
                                  <td className="tabular-nums">{h.startDate} ~ {h.endDate ?? ""}</td>
                                  <td className="text-right tabular-nums font-semibold">{won(h.amount)}원</td>
                                  <td className="tabular-nums text-[#596578]">{hd === null ? "첫 계약" : `${signed(hd)}원 (${hd >= 0 ? "+" : ""}${Math.round(hd / before!.amount * 1000) / 10}%)`}</td>
                                  <td className="text-[#596578]">{h.jobTitle ?? ""}{h.renewed ? " · 갱신됨" : ""}</td>
                                  <td><button type="button" className="text-[12.5px] font-semibold text-[#dc2626] hover:underline" onClick={() => void removeRow(p, h)}>지우기</button></td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )];
                })}
              </tbody>
            </table>
          </div>
        </Box>
      </>)}
    </div>
  );
}
