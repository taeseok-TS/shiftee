"use client";

// 포털(직영인사) 인원명부 연동 — 포털 → 큐브티 한 방향, 매일 06:30 자동 (2026-09-15 디렉터 결정)
// 일반 칸(이름·지점·직책·직급·입사일)은 "자동 반영"이 켜져 있으면 바로, 입사·퇴사·휴직·복직·사번 연결은 여기서 1클릭 확인.
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, Check, X, AlertTriangle, Link2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Pair = [string | null, string];
type Change = { id: string; empNo: number; portalId: string; name: string; userId: string | null; kind: string; diff: Record<string, unknown>; status: string; decidedBy: string | null; decidedAt: string | null; updatedAt: string };
type Summary = {
  skipped?: { portalId: string; name: string; reason: string }[];
  roleMismatch?: { empNo: number; name: string; branch: string | null }[];
  missingInPortal?: { empNo: number | null; name: string; branch: string | null }[];
};
type Run = { id: string; trigger: string; startedAt: string; finishedAt: string | null; ok: boolean; error: string | null; fetched: number; matched: number; applied: number; pending: number; skipped: number; actorName: string | null; summary: Summary | null };
type Data = { configured: boolean; canEditConnection: boolean; connection: { urlLabel: string; urlSet: boolean; leaversSet?: boolean; apikeySet: boolean; tokenSet: boolean }; autoApply: boolean; runs: Run[]; pending: Change[]; recent: Change[] };

// 오늘(KST) — 퇴사 카드의 "지난 날짜" 경고용. 렌더 중에 Date.now() 를 부르지 않게 화면을 열 때 한 번만 잡는다
const TODAY_KST = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const KIND_LABEL: Record<string, string> = { UPDATE: "정보 변경", HIRE: "입사", RESIGN: "퇴사", LEAVE: "휴직", RETURN: "복직·재입사", LINK: "사번 연결" };
const KIND_TONE: Record<string, string> = {
  UPDATE: "bg-gray-100 text-gray-700", HIRE: "bg-green-100 text-green-800", RESIGN: "bg-red-100 text-red-700",
  LEAVE: "bg-amber-100 text-amber-800", RETURN: "bg-blue-100 text-blue-800", LINK: "bg-indigo-100 text-indigo-800",
};
const FIELD_LABEL: Record<string, string> = { name: "이름", branch: "지점", jobGroup: "직책", position: "직급", hireDate: "입사일" };
const STATUS_LABEL: Record<string, string> = { APPLIED: "자동 반영", DONE: "확인 후 반영", DISMISSED: "무시" };
const pad = (n: number | null | undefined) => (n == null ? "-" : String(n).padStart(5, "0"));
const s = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : String(v));

type Target = { name?: string; branch?: string | null; empNo?: number | null; hireDate?: string | null };
type PortalSide = { branch?: string | null; joinDate?: string | null };
const targetOf = (c: Change) => (c.diff.target ?? null) as Target | null;
const portalOf = (c: Change) => (c.diff.portal ?? null) as PortalSide | null;
/** 일반 칸 변경이라도 개명·원장 계정·이름만 같은 약한 일치면 개별 확인으로 */
const needsConfirm = (c: Change) => c.kind !== "UPDATE" || !!c.diff.nameMismatch || !!c.diff.managerScope || !!c.diff.weakIdentity || !!c.diff.unverified;

function TargetLine({ c }: { c: Change }) {
  const tg = targetOf(c);
  const pt = portalOf(c);
  if (!tg) return null;
  return (
    <div className="text-[11px] text-gray-500 space-y-0.5">
      {c.diff.weakIdentity ? <p className="text-red-700 flex items-center gap-1"><AlertTriangle size={12} />이름만 같습니다{Array.isArray(c.diff.weakReasons) && (c.diff.weakReasons as string[]).length ? `(${(c.diff.weakReasons as string[]).join("·")})` : ""}. 동명이인일 수 있으니 같은 사람인지 확인해주세요.</p> : null}
      {!c.diff.weakIdentity && c.diff.unverified ? <p className="text-amber-700">이메일·지점·입사일로 같은 사람임이 확인되지 않았습니다 — 양쪽을 보고 반영해주세요.</p> : null}
      <p>큐브티 대상: <b className="text-gray-700">{tg.branch ?? "-"} {tg.name}</b> (사번 {pad(tg.empNo ?? null)}{tg.hireDate ? ` · 입사 ${tg.hireDate}` : ""})</p>
      {pt ? <p>명부: {pt.branch ?? "-"} {c.name} (사번 {c.portalId}{pt.joinDate ? ` · 입사 ${pt.joinDate}` : ""})</p> : null}
    </div>
  );
}

function Detail({ c }: { c: Change }) {
  const d = c.diff;
  if (c.kind === "UPDATE") {
    const fields = (d.fields ?? {}) as Record<string, Pair>;
    return (
      <div className="text-xs text-gray-700 space-y-0.5">
        {d.nameMismatch ? <p className="text-red-700 flex items-center gap-1"><AlertTriangle size={12} />이름이 바뀌었습니다(회사 이메일은 같음). 같은 사람인지 확인한 뒤 반영해주세요.</p> : null}
        {d.managerScope ? <p className="text-amber-700 flex items-center gap-1"><AlertTriangle size={12} />원장 계정입니다. 지점·직책이 바뀌면 담당 범위가 따라 바뀌어 확인 후 반영합니다.</p> : null}
        {Object.entries(fields).map(([k, v]) => (
          <p key={k}><span className="text-gray-500">{FIELD_LABEL[k] ?? k}</span> {v[0] || "-"} → <b>{v[1]}</b></p>
        ))}
        <TargetLine c={c} />
      </div>
    );
  }
  if (c.kind === "HIRE") {
    const missing = Array.isArray(d.missing) ? (d.missing as string[]) : [];
    return (
      <div className="text-xs text-gray-700 space-y-0.5">
        <p>{d.onLeave ? "지점 없음(휴직)" : s(d.branch ?? d.portalBranch)} · {s(d.jobGroup)} · {s(d.position)} · 입사 {s(d.hireDate)} · {s(d.email)}{d.onLeave ? " · 휴직 중" : ""}</p>
        {missing.length ? <p className="text-red-700">{missing.join("·")}이(가) 없어 지금은 반영할 수 없습니다.</p>
          : d.onLeave
            ? <p className="text-gray-500">휴직자라 지점 없이 휴직으로 만들고, 비밀번호는 알려진 값으로 열어 두지 않습니다. 복직하면 명부의 지점이 정보 변경으로 올라오니 먼저 반영하시고, 직원 관리에서 비밀번호 초기화(임시 비밀번호)를 해 주세요.</p>
            : <p className="text-gray-500">반영하면 임시 비밀번호(12345678)로 계정을 만들고, 24시간 뒤 봇이 변경을 요청합니다.</p>}
        {portalOf(c) ? <p className="text-[11px] text-gray-500">명부: {portalOf(c)?.branch ?? "-"} {c.name} (사번 {c.portalId}{portalOf(c)?.joinDate ? ` · 입사 ${portalOf(c)?.joinDate}` : ""})</p> : null}
        {Array.isArray(d.sameNameInCubetee) && (d.sameNameInCubetee as Target[]).length > 0 ? (
          <p className="text-red-700 flex items-center gap-1"><AlertTriangle size={12} />큐브티에 같은 이름이 있습니다: {(d.sameNameInCubetee as Target[]).map((x) => `${x.branch ?? "-"} ${x.name}(${pad(x.empNo ?? null)})`).join(", ")} — 같은 사람이면 입사 대신 직원 관리에서 사번을 명부 사번으로 고쳐주세요.</p>
        ) : null}
      </div>
    );
  }
  if (c.kind === "RESIGN") {
    // 근거를 보여준다 — "명부가 퇴사라고 한 것"과 "명부에서 사라져 퇴사자 탭에서 찾은 것"은 무게가 다르다(검증관 D3)
    const missing = d.portalStatus === "명부에 없음";
    const past = s(d.resignDate) < TODAY_KST;
    return (
      <div className="text-xs text-gray-700 space-y-0.5">
        <p>퇴사일 <b>{s(d.resignDate)}</b>{d.leaveDateFrom === "퇴사자 탭" ? " (퇴사자 탭에서 이름·입사일·지점으로 찾음)" : ""} · 반영하면 바로 로그아웃되고, 퇴사일이 지나면 로그인이 막히며 결재선에서 빠집니다.</p>
        {missing ? <p className="text-amber-700 flex items-center gap-1"><AlertTriangle size={12} />명부가 퇴사라고 한 게 아니라 <b>명부에서 사라져</b> 퇴사자 탭에서 찾은 건입니다 — 사번이 바뀌었거나 명부 편집 실수일 수 있으니 확인해주세요.</p> : null}
        {past ? <p className="text-red-700 flex items-center gap-1"><AlertTriangle size={12} />지난 날짜입니다 — 반영 즉시 로그인이 막힙니다.</p> : null}
        <TargetLine c={c} />
      </div>
    );
  }
  if (c.kind === "LEAVE") return <div className="text-xs text-gray-700 space-y-0.5"><p>명부에서 휴직 — 큐브티 재직상태를 휴직으로 바꿉니다.</p><TargetLine c={c} /></div>;
  if (c.kind === "RETURN") return (
    <div className="text-xs text-gray-700 space-y-0.5">
      <p>{d.from === "RESIGNED" ? "큐브티에서 퇴사 처리된 직원이 명부에서는 재직입니다(재입사). 반영하면 계정을 다시 켜고 퇴사일 기록을 지웁니다 — 퇴직자 현황의 과거 집계에서도 빠집니다." : "명부에서 복직 — 재직으로 바꿉니다."}</p>
      {/* 휴직자는 지점 없이 만들어진다 — 지점을 먼저 넣어야 복직이 반영된다(서버도 막는다) */}
      {d.to !== "LEAVE" && !(d.target as Target | undefined)?.branch ? (
        <p className="text-amber-700 flex items-center gap-1"><AlertTriangle size={12} />지점이 비어 있습니다 — 지점 변경을 먼저 반영하거나 직원 관리에서 지점을 넣어야 복직이 반영됩니다. 비밀번호 초기화도 함께 해 주세요.</p>
      ) : null}
      <TargetLine c={c} />
    </div>
  );
  if (c.kind === "LINK") return (
    <div className="text-xs text-gray-700 space-y-0.5">
      <p>큐브티 사번 {pad(d.fromEmpNo as number | null)} → <b>명부 사번 {pad(d.toEmpNo as number)}</b> ({d.by === "email" ? "회사 이메일이 같음" : "이름·지점이 같음 — 동명이인이 아닌지 확인해주세요"})</p>
      <TargetLine c={c} />
    </div>
  );
  return null;
}

export default function PortalSyncPage() {
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [conn, setConn] = useState({ url: "", leaversUrl: "", apikey: "", token: "" });
  const load = useCallback(() => {
    // 주소는 다시 내려주지 않는다 — 시트 주소 자체가 열쇠라서(검증관 2)
    fetch("/api/admin/portal-sync").then((r) => r.json()).then((d: Data) => setData(d)).catch(() => toast.error("불러오지 못했습니다."));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function post(body: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const res = await fetch("/api/admin/portal-sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "실패했습니다."); return null; }
      return d;
    } finally { setBusy(null); }
  }
  async function run() {
    const d = await post({ action: "run" }, "run");
    if (d?.result) toast.success(`가져왔습니다 — 자동 반영 ${d.result.applied}건 · 확인 대기 ${d.result.pending}건 · 건너뜀 ${d.result.skipped}건`);
    load();
  }
  async function setAuto(value: boolean) {
    if (value && !confirm("일반 칸(이름·지점·직책·직급·입사일)을 매일 포털 값으로 바로 맞춥니다. 큐브티에서 고친 값은 다음 날 포털 값으로 되돌아갑니다. 켤까요?")) return;
    if (await post({ action: "setAuto", value }, "auto")) { toast.success(value ? "자동 반영을 켰습니다." : "자동 반영을 껐습니다."); load(); }
  }
  async function applyAll() {
    const d = await post({ action: "applyAllUpdates" }, "all");
    if (d) { toast.success(`정보 변경 ${d.done}건을 반영했습니다${d.failed ? ` (실패 ${d.failed}건)` : ""}.`); load(); }
  }
  async function decide(c: Change, action: "apply" | "dismiss") {
    const tg = targetOf(c);
    const who = tg ? `큐브티 ${tg.branch ?? "-"} ${tg.name}님(사번 ${pad(tg.empNo ?? null)})` : `${c.name}님`;
    const pt = portalOf(c);
    const warn = c.diff.weakIdentity ? "\n⚠ 이름만 같습니다 — 동명이인이 아닌지 확인해주세요."
      : c.diff.unverified ? "\n⚠ 이메일·지점·입사일로 같은 사람임이 확인되지 않았습니다." : "";
    if (action === "apply" && c.kind !== "UPDATE" && !confirm(`${who}에게 「${KIND_LABEL[c.kind] ?? c.kind}」을(를) 반영할까요?\n명부: ${pt?.branch ?? "-"} ${c.name} (사번 ${c.portalId})${warn}`)) return;
    if (action === "apply" && c.kind === "UPDATE" && needsConfirm(c) && !confirm(`${who}의 정보를 명부 값으로 바꿀까요?\n명부: ${pt?.branch ?? "-"} ${c.name} (사번 ${c.portalId})${warn}`)) return;
    setBusy(c.id);
    try {
      const res = await fetch(`/api/admin/portal-sync/changes/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "실패했습니다."); return; }
      toast.success(action === "apply" ? "반영했습니다." : "무시했습니다. 같은 상황이 이어지는 동안은 다시 올라오지 않습니다.");
      load();
    } finally { setBusy(null); }
  }
  async function saveConn() {
    if (await post({ action: "saveConnection", ...conn }, "save")) { toast.success("연결 정보를 저장했습니다."); setConn((c) => ({ ...c, apikey: "", token: "", leaversUrl: "" })); load(); }
  }
  async function testConn() {
    const d = await post({ action: "testConnection" }, "test");
    if (d?.ok) toast.success(`연결됐습니다 — ${d.count}명 (사번 있음 ${d.withEmpNo}명) · ${Object.entries(d.byStatus as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  }

  if (!data) return <div className="p-8 text-sm text-gray-500">불러오는 중…</div>;
  const last = data.runs[0];
  const sum = last?.summary ?? {};
  const pendingUpdates = data.pending.filter((c) => !needsConfirm(c) && c.status === "PENDING");
  const confirms = data.pending.filter((c) => needsConfirm(c) || c.status === "APPLYING");

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2"><RefreshCw size={20} className="text-indigo-600" />인사명부 연동</h1>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${data.configured ? "bg-green-50 text-green-700 border-green-200" : "bg-gray-100 text-gray-600 border-gray-200"}`}>{data.configured ? "연결됨" : "연결 정보 없음"}</span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" disabled={!data.configured || busy === "auto"} onClick={() => setAuto(!data.autoApply)}>일반 칸 자동 반영: {data.autoApply ? "켜짐" : "꺼짐"}</Button>
          <Button className="gap-1 bg-indigo-600 hover:bg-indigo-700" disabled={!data.configured || busy === "run"} onClick={run}><RefreshCw size={15} className={busy === "run" ? "animate-spin" : ""} />지금 가져오기</Button>
        </div>
      </div>
      <p className="text-xs text-gray-500">직영인사 포털의 인원명부를 매일 06:30 에 읽어 큐브티 직원 정보를 맞춥니다. 포털은 읽기만 하고 고치지 않습니다. 이름·지점·직책·직급·입사일은 자동 반영을 켜면 바로 바뀌고, 입사·퇴사·휴직·복직·사번 연결은 아래에서 확인해야 반영됩니다.</p>

      {last && (
        <Card><CardContent className="p-3 text-sm flex flex-wrap gap-x-5 gap-y-1">
          <span>마지막 가져오기 <b>{format(new Date(last.startedAt), "M/d HH:mm")}</b> ({last.trigger === "AUTO" ? "자동" : last.actorName})</span>
          {last.ok ? (<>
            <span>명부 {last.fetched}명 · 사번 일치 {last.matched}명</span>
            <span>자동 반영 {last.applied} · 확인 대기 {last.pending} · 건너뜀 {last.skipped}</span>
          </>) : <span className="text-red-700 flex items-center gap-1"><AlertTriangle size={14} />실패 — {last.error}</span>}
        </CardContent></Card>
      )}

      {/* 확인 대기 */}
      <section className="space-y-2">
        <h2 className="font-semibold">확인 대기 {confirms.length}건</h2>
        {!confirms.length ? <p className="text-sm text-gray-500">확인할 항목이 없습니다.</p> : confirms.map((c) => (
          <div key={c.id} className="bg-white border rounded-lg p-3 flex items-start gap-3">
            <span className={`text-[11px] px-2 py-0.5 rounded-full shrink-0 ${KIND_TONE[c.kind] ?? ""}`}>{KIND_LABEL[c.kind] ?? c.kind}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{c.name} <span className="text-xs text-gray-400">명부 사번 {c.portalId}</span>{c.status === "APPLYING" ? <span className="ml-1 text-[11px] text-amber-700">반영 중…</span> : null}</p>
              <Detail c={c} />
            </div>
            <div className="flex gap-1.5 shrink-0">
              <Button size="sm" className="h-8 gap-1 bg-indigo-600 hover:bg-indigo-700" disabled={busy === c.id || c.status === "APPLYING"} onClick={() => decide(c, "apply")}><Check size={14} />반영</Button>
              <Button size="sm" variant="outline" className="h-8 gap-1" disabled={busy === c.id || c.status === "APPLYING"} onClick={() => decide(c, "dismiss")}><X size={14} />무시</Button>
            </div>
          </div>
        ))}
      </section>

      {/* 자동 반영이 꺼져 있을 때 쌓인 일반 칸 변경 */}
      {pendingUpdates.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">정보 변경 {pendingUpdates.length}건 <span className="text-xs font-normal text-gray-500">(자동 반영이 꺼져 있어 모아 두었습니다)</span></h2>
            <Button size="sm" className="ml-auto h-8 bg-indigo-600 hover:bg-indigo-700" disabled={busy === "all"} onClick={applyAll}>모두 반영</Button>
          </div>
          <div className="bg-white border rounded-lg divide-y">
            {pendingUpdates.map((c) => (
              <div key={c.id} className="p-2.5 flex items-start gap-3">
                <p className="text-sm w-32 shrink-0">{c.name} <span className="block text-[11px] text-gray-400">사번 {c.portalId}</span></p>
                <div className="flex-1"><Detail c={c} /></div>
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy === c.id} onClick={() => decide(c, "dismiss")}>무시</Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 마지막 실행에서 걸린 것들 */}
      {last?.ok && ((sum.skipped?.length ?? 0) > 0 || (sum.missingInPortal?.length ?? 0) > 0 || (sum.roleMismatch?.length ?? 0) > 0) && (
        <section className="grid md:grid-cols-3 gap-3">
          <Card><CardContent className="p-3 space-y-1">
            <p className="text-sm font-semibold">건너뜀 {sum.skipped?.length ?? 0}</p>
            <p className="text-[11px] text-gray-500">포털 값을 큐브티에 맞출 수 없어 반영하지 않은 것</p>
            <ul className="text-xs text-gray-700 max-h-56 overflow-y-auto space-y-0.5">{(sum.skipped ?? []).map((x, i) => <li key={i}>{x.name} <span className="text-gray-400">{x.portalId}</span> — {x.reason}</li>)}</ul>
          </CardContent></Card>
          <Card><CardContent className="p-3 space-y-1">
            <p className="text-sm font-semibold">포털에 없는 큐브티 재직자 {sum.missingInPortal?.length ?? 0}</p>
            <p className="text-[11px] text-gray-500">사번이 명부와 다르거나 명부에 아직 없는 직원 — 자동으로 퇴사시키지 않습니다</p>
            <ul className="text-xs text-gray-700 max-h-56 overflow-y-auto space-y-0.5">{(sum.missingInPortal ?? []).map((x, i) => <li key={i}>{x.branch ?? "-"} {x.name} <span className="text-gray-400">{pad(x.empNo)}</span></li>)}</ul>
          </CardContent></Card>
          <Card><CardContent className="p-3 space-y-1">
            <p className="text-sm font-semibold">원장 권한 확인 {sum.roleMismatch?.length ?? 0}</p>
            <p className="text-[11px] text-gray-500">명부 직무는 원장인데 큐브티 권한은 직원 — 권한은 직원 관리에서 직접 바꿔주세요</p>
            <ul className="text-xs text-gray-700 max-h-56 overflow-y-auto space-y-0.5">{(sum.roleMismatch ?? []).map((x, i) => <li key={i}>{x.branch ?? "-"} {x.name} <span className="text-gray-400">{pad(x.empNo)}</span></li>)}</ul>
          </CardContent></Card>
        </section>
      )}

      {/* 최근 반영 기록 */}
      <section className="space-y-2">
        <h2 className="font-semibold">최근 반영 기록</h2>
        {!data.recent.length ? <p className="text-sm text-gray-500">아직 없습니다.</p> : (
          <div className="bg-white border rounded-lg divide-y">
            {data.recent.map((c) => (
              <div key={c.id} className="p-2.5 flex items-start gap-3 text-xs">
                <span className="text-gray-400 w-20 shrink-0">{format(new Date(c.updatedAt), "M/d HH:mm")}</span>
                <span className={`px-2 py-0.5 rounded-full shrink-0 ${KIND_TONE[c.kind] ?? ""}`}>{KIND_LABEL[c.kind] ?? c.kind}</span>
                <span className="w-28 shrink-0">{c.name}</span>
                <div className="flex-1"><Detail c={c} /></div>
                <span className="text-gray-500 shrink-0">{STATUS_LABEL[c.status] ?? c.status}{c.decidedBy ? ` · ${c.decidedBy}` : ""}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 연결 정보 — 메인 관리자만 */}
      <Card><CardContent className="p-4 space-y-3">
        <p className="font-semibold flex items-center gap-2"><Link2 size={16} />연결 정보</p>
        <p className="text-xs text-gray-500">직영 인사 원장(구글 시트) 주소를 넣습니다 — 편집 주소를 그대로 붙여 넣으셔도 됩니다. 시트는 읽기만 하고 고치지 않습니다. (아래 키·토큰은 예전 포털 DB 방식을 쓸 때만 필요합니다.)</p>
        {data.canEditConnection ? (
          <div className="grid md:grid-cols-3 gap-2">
            <Input placeholder={data.connection.urlSet ? `주소 — 등록됨(${data.connection.urlLabel}). 바꿀 때만 입력` : "https://docs.google.com/spreadsheets/d/… (인사 원장 주소)"} value={conn.url} onChange={(e) => setConn({ ...conn, url: e.target.value })} className="md:col-span-3" />
            <Input placeholder={data.connection.leaversSet ? "퇴사자 탭 — 등록됨. 바꿀 때만 입력" : "퇴사자 탭 주소(선택) — 같은 파일의 「퇴사자 (RAW)」 탭을 연 주소. 퇴사일을 여기서 찾습니다"} value={conn.leaversUrl} onChange={(e) => setConn({ ...conn, leaversUrl: e.target.value })} className="md:col-span-3" />
            <Input type="password" autoComplete="off" placeholder={data.connection.apikeySet ? "API 키 — 등록됨(바꿀 때만 입력)" : "API 키 (시트는 비워 두세요)"} value={conn.apikey} onChange={(e) => setConn({ ...conn, apikey: e.target.value })} />
            <Input type="password" autoComplete="off" placeholder={data.connection.tokenSet ? "읽기 전용 토큰 — 등록됨(바꿀 때만 입력)" : "읽기 전용 토큰 (시트는 비워 두세요)"} value={conn.token} onChange={(e) => setConn({ ...conn, token: e.target.value })} />
            <div className="flex gap-2">
              <Button className="flex-1" disabled={busy === "save" || (!conn.url && !conn.leaversUrl)} onClick={saveConn}>저장</Button>
              <Button variant="outline" className="flex-1" disabled={busy === "test" || !data.configured} onClick={testConn}>연결 확인</Button>
            </div>
          </div>
        ) : <p className="text-xs text-gray-500">{data.configured ? `연결됨 — ${data.connection.urlLabel}` : "메인 관리자가 연결 정보를 넣어야 합니다."}</p>}
      </CardContent></Card>
    </div>
  );
}
