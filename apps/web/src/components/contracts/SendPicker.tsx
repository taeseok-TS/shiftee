"use client";

// 계약서 보내기 1단계 — 서류 고르기(2026-10-17 본부 박정인 님 개선 시안 1·2 → 2026-10-20 시안 v2: 한 화면 3단계의 첫 단계).
//
// **고르기만** 한다: 용도 → 양식 카드(또는 묶음) → 받는 사람. [다음: 내용 입력]을 누르면 같은 화면(ContractsScreen flow)의
// 2단계로 넘어가 「보낸 계약서」 작성 창과 같은 폼이 펼쳐진다. 작성·검사·미리보기는 그 폼 그대로 — 여기서 복제하지 않는다.
// 외부(미가입) 계약·코디/외부 채용 패키지 같은 특수 흐름은 「보낸 계약서」 → 「계약서 작성」에 그대로 있다(아래 안내 링크).
import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseApprovalSteps, stepsLabel, templateStepsFor } from "@/lib/approval-order";
import { CONTRACT_PURPOSES, OTHER_PURPOSE, parsePurposeMap, purposesOf, type ContractPurpose } from "@/lib/contract-purpose";
import { RESIGN_DOC_LABELS, RESIGN_PICK_DEFAULT, findPackageTemplates } from "@/lib/contract-packages";

type Template = {
  id: string; name: string; description?: string | null; type: string; createdAt?: string;
  postSignAccess?: string; approvalSteps?: unknown; approvalStepsRenewal?: unknown; pinned?: boolean;
};
type Employee = { id: string; name: string; branch?: string | null; department?: string | null; role?: string };
type PurposeKey = ContractPurpose | "other";
// 고른 서류 — 양식 하나, 신규입사 묶음, 퇴사 서류 고르기. purpose 는 고를 때의 용도(재계약 카드에서 고르면 작성 창의 계약 구분이 재계약)
export type Pick = { kind: "tpl"; id: string; purpose: PurposeKey } | { kind: "hire" } | { kind: "resign" } | null;
/** 1단계에서 고른 것 — 2단계 작성 폼을 여는 값(종전 ?compose= 주소와 같은 뜻) */
export type SendSelection = { pick: NonNullable<Pick>; recipients: string[]; resignPicks: boolean[]; purpose: PurposeKey; multi: boolean };

// 서명 완료 후 근로자 접근(#129) — 시안 표기
const ACCESS_LABEL: Record<string, string> = { full: "근로자 열람·다운로드", view: "열람만", none: "보관만" };
const ACCESS_CLASS: Record<string, string> = {
  full: "bg-indigo-50 text-indigo-600 border-indigo-200",
  view: "bg-sky-50 text-sky-800 border-sky-200",
  none: "bg-gray-100 text-gray-600 border-gray-200",
};

// 날짜를 KST 「10/14」 꼴로(서버 시각은 UTC)
const kstMd = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  if (isNaN(d.getTime())) return "";
  return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, "0")}`;
};

function DocThumb() {
  return (
    <div className="hidden sm:flex w-14 h-[70px] shrink-0 flex-col gap-1.5 rounded border border-gray-200 bg-white p-2" aria-hidden>
      <span className="h-0.5 w-7 bg-gray-700" />
      {[0, 1, 2, 3].map(i => <span key={i} className="h-0.5 w-full bg-gray-200" />)}
      <span className="h-0.5 w-6 bg-gray-200" />
    </div>
  );
}

export default function SendPicker({ initial, onNext, onTest, stepper }: {
  initial?: SendSelection | null;
  stepper?: ReactNode;   // 「1 서류 고르기 — 2 내용 입력 — 3 결재자·발송」 표시(제목 오른쪽 위)
  onNext: (sel: SendSelection) => void;
  onTest: (pick: Extract<NonNullable<Pick>, { kind: "tpl" }>) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [purposeMap, setPurposeMap] = useState<Record<string, ContractPurpose[]>>({});
  const [lastUsed, setLastUsed] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  // 양식 id → {#신규입사}/{#재계약} 구간이 있는가. 재계약 순서는 실제 발송처럼 이 구간이 있는 양식에만 적용된다
  // (작성 창이 「계약구분」 값을 넣는 조건 = lib/approval-order isRenewalContract). 재계약 순서가 있는 양식만 물어본다
  const [hasKindCond, setHasKindCond] = useState<Record<string, boolean>>({});

  // 2·3단계에서 「이전」으로 돌아오면 고른 값이 그대로 남는다(initial)
  const [purpose, setPurpose] = useState<PurposeKey>(initial?.purpose ?? "hire");
  const [pick, setPick] = useState<Pick>(initial?.pick ?? null);
  const [resignPicks, setResignPicks] = useState<boolean[]>(initial?.resignPicks ?? [...RESIGN_PICK_DEFAULT]);
  const [multi, setMulti] = useState(initial?.multi ?? false);
  const [recipients, setRecipients] = useState<string[]>(initial?.recipients ?? []);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let stop = false;
    Promise.all([
      fetch("/api/contract-templates").then(r => (r.ok ? r.json() : { templates: [] })).catch(() => ({ templates: [] })),
      // includeAdmins: 「보낸 계약서」 작성 창과 같은 목록(받는 사람에서는 관리자를 뺀다)
      fetch("/api/employees?includeAdmins=true").then(r => (r.ok ? r.json() : { employees: [] })).catch(() => ({ employees: [] })),
      fetch("/api/admin/contract-purposes").then(r => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ purposes?: unknown; lastUsed?: Record<string, string> }>,
    ]).then(([t, e, p]) => {
      if (stop) return;
      setTemplates(t.templates || []);
      setEmployees(e.employees || []);
      setPurposeMap(parsePurposeMap(p.purposes));
      setLastUsed(p.lastUsed || {});
      setLoading(false);
      const withRenewal = ((t.templates || []) as Template[]).filter(x => x.approvalStepsRenewal != null);
      Promise.all(withRenewal.map(x => fetch(`/api/contract-templates/${x.id}/fields`).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
        .then((d: { conditions?: string[] }) => [x.id, (d.conditions || []).includes("신규입사")] as const)))
        .then(rows => { if (!stop) setHasKindCond(Object.fromEntries(rows)); });
    });
    return () => { stop = true; };
  }, []);

  const pkg = useMemo(() => findPackageTemplates(templates), [templates]);
  const purposeOfTpl = (t: Template) => purposesOf(t, purposeMap);
  const listFor = (k: PurposeKey) => templates.filter(t => {
    const ps = purposeOfTpl(t);
    return k === "other" ? ps.length === 0 : ps.includes(k);
  });
  const hasOther = templates.some(t => purposeOfTpl(t).length === 0);
  const purposeCards = [...CONTRACT_PURPOSES, ...(hasOther ? [OTHER_PURPOSE] : [])];
  const list = listFor(purpose);

  // 받는 사람 — 계약 대상은 직원·원장(관리자 제외). 「보낸 계약서」 작성 창과 같은 거르기
  const candidates = employees.filter(e => e.role !== "ADMIN");
  const q = search.trim().toLowerCase();
  const found = q ? candidates.filter(e => e.name.toLowerCase().includes(q) || (e.branch || "").toLowerCase().includes(q) || (e.department || "").toLowerCase().includes(q)).slice(0, 30) : [];
  const empOf = (id: string) => employees.find(e => e.id === id);
  // 퇴사 서류는 한 명씩만(작성 창이 퇴사 패키지 여러 명 작성을 막는다 — 상태 꼬임 사고, 2026-08-26 검증)
  const multiAllowed = pick?.kind !== "resign";
  const multiOn = multi && multiAllowed;

  const toggleRecipient = (id: string) => {
    setRecipients(prev => {
      if (!multiOn) return prev[0] === id ? [] : [id];
      return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
    });
    if (!multiOn) setSearch("");
  };
  const choose = (p: Pick) => {
    setPick(p);
    if (p?.kind === "resign") {
      setResignPicks([...RESIGN_PICK_DEFAULT]);
      if (recipients.length > 1) { setRecipients(r => r.slice(0, 1)); toast.info("퇴사 서류는 한 명씩 보냅니다. 첫 번째 받는 사람만 남겼습니다."); }
    }
  };

  const pickedTpl = pick?.kind === "tpl" ? templates.find(t => t.id === pick.id) : undefined;
  // 재계약 카드에서 고르면 작성 창이 계약 구분을 재계약으로 연다 — 양식에 그 구간이 있고 재계약 순서가 있을 때만 재계약 순서가 실제로 쓰인다(발송과 같은 판정)
  const stepsOf = (t: Template, renewCard: boolean) =>
    stepsLabel(parseApprovalSteps(templateStepsFor(t, renewCard && t.approvalStepsRenewal != null && hasKindCond[t.id] === true)));
  const hireDocs = [pkg.empTemplate?.name, pkg.privacyTemplate?.name].filter(Boolean) as string[];
  const resignDocNames = RESIGN_DOC_LABELS.filter((_, i) => i === 0 || resignPicks[i]);

  // 오른쪽 패널의 「고른 서류」
  const pickedTitle = pick?.kind === "hire" ? "신규입사 묶음" : pick?.kind === "resign" ? "퇴사 서류 고르기" : pickedTpl?.name ?? "";
  const pickedSub = pick?.kind === "hire" ? hireDocs.join(" · ")
    : pick?.kind === "resign" ? `${resignDocNames.join(" · ")} — 1년 미만이면 퇴직금 정산 자동 제외`
    : pickedTpl ? `결재 ${stepsOf(pickedTpl, pick?.kind === "tpl" && pick.purpose === "renew")}` : "";

  const goCompose = () => {
    if (!pick) { toast.error("보낼 서류를 먼저 고르세요."); return; }
    if (!recipients.length) { toast.error("받는 사람을 고르세요."); return; }
    onNext({ pick, recipients: multiOn ? recipients : recipients.slice(0, 1), resignPicks, purpose, multi: multiOn });
  };
  // 나에게 테스트 발송(#67) — 작성 폼의 기능 그대로. 서명자는 나라 받는 사람은 쓰지 않고, 묶음·여러 명은 테스트 발송이 없다
  const goTest = () => {
    if (pick?.kind !== "tpl") { toast.error("테스트 발송은 양식 하나를 고른 뒤에 할 수 있습니다(묶음은 테스트 발송이 없습니다)."); return; }
    onTest(pick);
  };

  const bundleCard = (kind: "hire" | "resign") => {
    const on = pick?.kind === kind;
    const can = kind === "hire" ? pkg.canBundle : pkg.canResignBundle;
    return (
      <div className={cn("rounded-xl border bg-white p-4 flex flex-col sm:flex-row sm:items-center gap-3", on ? "border-indigo-600 ring-1 ring-indigo-600" : "border-gray-200")}>
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-[11px] font-semibold text-amber-700">묶음으로 한 번에</p>
          <p className="font-bold text-gray-900">{kind === "hire" ? "신규입사 묶음" : "퇴사 서류 고르기"}</p>
          <p className="text-xs text-gray-500">
            {kind === "hire" ? `첫 출근일 오전에 함께 보내는 ${hireDocs.length}종` : "사직원 항상 포함 · 1년 미만이면 퇴직금 정산 자동 제외"}
          </p>
          {!can && <p className="text-xs text-rose-600">묶음에 들어갈 양식이 다 등록돼 있지 않아 지금은 쓸 수 없습니다(양식 관리에서 확인).</p>}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {kind === "hire" ? hireDocs.map(n => (
              <span key={n} className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700">{n}</span>
            )) : on ? RESIGN_DOC_LABELS.map((label, i) => (
              // 고른 뒤에는 문서마다 넣고 빼기(작성 창의 「문서 고르기」와 같은 값으로 넘어간다). 사직원은 대표 문서라 항상
              <label key={label} className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                (i === 0 || resignPicks[i]) ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-gray-200 bg-white text-gray-500",
                i === 0 ? "opacity-80" : "cursor-pointer")}>
                <input type="checkbox" className="h-3 w-3" checked={i === 0 || resignPicks[i]} disabled={i === 0}
                  onChange={e => setResignPicks(p => p.map((v, j) => (j === i ? e.target.checked : v)))} />
                {label}
              </label>
            )) : (
              <>
                {RESIGN_DOC_LABELS.filter((_, i) => RESIGN_PICK_DEFAULT[i]).map(n => (
                  <span key={n} className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700">{n}</span>
                ))}
                <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[11px] text-gray-700">+ 필요할 때 금품청산·퇴직금·연차수당</span>
              </>
            )}
          </div>
        </div>
        <button type="button" disabled={!can} onClick={() => choose(on ? null : { kind })} aria-pressed={on}
          aria-label={`${kind === "hire" ? "신규입사 묶음" : "퇴사 서류 고르기"} ${on ? "고름(누르면 취소)" : "고르기"}`}
          className={cn("shrink-0 self-start sm:self-center rounded-lg px-3 py-2 text-sm font-medium border disabled:opacity-40",
            on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-900 border-gray-300 hover:bg-gray-50")}>
          {on ? "고름" : "묶음 고르기"}
        </button>
      </div>
    );
  };

  return (
    <div className={cn("space-y-5", pick && "pb-24 lg:pb-0")}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs text-gray-500">전자계약 › 계약서 보내기</p>
          <h1 className="text-2xl font-bold text-gray-900">어떤 서류를 보내시나요?</h1>
          <div className="mt-1 flex gap-3 text-xs">
            <Link href="/admin/contracts" className="text-gray-500 underline hover:text-indigo-600">보낸 계약서</Link>
            <button type="button" onClick={goTest} title="양식 하나를 고른 뒤 누르면 내용 입력이 열립니다. 내용을 채우고 「나에게 테스트 발송」을 누르세요"
              className="text-gray-500 underline hover:text-indigo-600">나에게 테스트 발송</button>
          </div>
        </div>
        {stepper}
      </div>

      {/* 용도 카드 — 고르면 그 용도 양식만 아래에 */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {purposeCards.map(p => {
          const on = purpose === p.key;
          return (
            <button key={p.key} type="button" onClick={() => setPurpose(p.key)} aria-pressed={on}
              className={cn("rounded-xl border p-3 text-left transition-colors",
                on ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-200 bg-white hover:border-indigo-300")}>
              <span className={cn("block text-[11px]", on ? "text-indigo-100" : "text-gray-500")}>{p.hint}</span>
              <span className="block text-lg font-bold leading-tight mt-0.5">{p.label}</span>
              <span className={cn("block text-xs mt-1", on ? "text-indigo-100" : "text-gray-500")}>양식 {loading ? "…" : listFor(p.key).length}개</span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
        {/* 왼쪽 — 묶음 + 양식 카드 2열 */}
        <div className="space-y-3 min-w-0">
          {purpose === "hire" && bundleCard("hire")}
          {purpose === "resign" && bundleCard("resign")}
          {loading ? (
            <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">양식을 불러오는 중…</p>
          ) : list.length === 0 ? (
            <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
              이 용도의 양식이 없습니다. <Link href="/admin/contract-templates" className="text-indigo-600 underline">양식 관리</Link>에서 양식의 용도를 정할 수 있습니다.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {list.map(t => {
                const on = pick?.kind === "tpl" && pick.id === t.id;
                const access = t.postSignAccess || "full";
                const used = lastUsed[t.id];
                return (
                  <div key={t.id} className={cn("rounded-xl border bg-white p-3 flex gap-3", on ? "border-indigo-600 ring-1 ring-indigo-600" : "border-gray-200")}>
                    <DocThumb />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-start gap-2">
                        <p className="flex-1 min-w-0 font-bold text-gray-900 leading-snug break-keep">{t.name}</p>
                        <button type="button" onClick={() => choose(on ? null : { kind: "tpl", id: t.id, purpose })} aria-pressed={on}
                          aria-label={`${t.name} ${on ? "고름(누르면 취소)" : "고르기"}`}
                          className={cn("shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium border",
                            on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-900 border-gray-300 hover:bg-gray-50")}>
                          {on ? "고름" : "고르기"}
                        </button>
                      </div>
                      {t.description && <p className="text-xs text-gray-500 line-clamp-1">{t.description}</p>}
                      <p className="text-xs font-semibold text-gray-800">결재 {stepsOf(t, purpose === "renew")}</p>
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", ACCESS_CLASS[access] || ACCESS_CLASS.full)}>{ACCESS_LABEL[access] || ACCESS_LABEL.full}</span>
                        <span className="text-[11px] text-gray-500">{used ? `${kstMd(used)} 사용` : `${kstMd(t.createdAt)} 등록`}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* 오른쪽 — 고른 서류·받는 사람 */}
        <aside id="send-panel" className="scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4 space-y-4 lg:sticky lg:top-4">
          <div className="border-b border-gray-100 pb-3">
            <p className="text-[11px] text-gray-500">고른 서류</p>
            {pick ? (
              <>
                <p className="font-bold text-gray-900 break-keep">{pickedTitle}</p>
                <p className="text-xs text-gray-500 break-keep">{pickedSub}</p>
              </>
            ) : <p className="text-sm text-gray-400">왼쪽에서 서류를 고르세요</p>}
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-gray-900 text-sm">받는 사람</p>
            {/* 한 명 / 여러 명 — 작은 체크 대신 큰 버튼(시안 v2 1번). 퇴사 서류는 한 명씩 */}
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="받는 사람 수">
              {([[false, "한 명"], [true, multiOn && recipients.length > 1 ? `여러 명 (${recipients.length})` : "여러 명"]] as const).map(([v, label]) => {
                const on = multiOn === v;
                const dis = v && !multiAllowed;
                return (
                  <button key={String(v)} type="button" role="radio" aria-checked={on} disabled={dis}
                    title={dis ? "퇴사 서류는 한 명씩 보냅니다" : v ? "같은 서류를 여러 명에게 — 사람마다 1건씩 만들어집니다" : undefined}
                    onClick={() => { setMulti(v); if (!v) setRecipients(r => r.slice(0, 1)); }}
                    className={cn("rounded-lg border py-2.5 text-sm font-semibold disabled:opacity-40",
                      on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50")}>
                    {label}
                  </button>
                );
              })}
            </div>
            <div className="relative">
              <Input placeholder="이름·지점으로 찾기" value={search} onChange={e => setSearch(e.target.value)} className="text-sm" />
              {q && (
                <div className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
                  {found.length === 0 ? <p className="px-3 py-3 text-center text-xs text-gray-500">찾는 사람이 없습니다</p> : found.map(e => {
                    const sel = recipients.includes(e.id);
                    return (
                      <button key={e.id} type="button" onClick={() => toggleRecipient(e.id)}
                        className={cn("flex w-full items-center gap-2 border-b border-gray-50 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-indigo-50", sel && "bg-indigo-50 font-medium")}>
                        <span className="w-4">{sel && <Check size={14} className="text-indigo-600" />}</span>
                        <span>{e.name}</span>
                        {e.branch && <span className="text-xs text-gray-500">· {e.branch}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {recipients.map(id => {
                  const e = empOf(id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs text-indigo-800">
                      {e?.name ?? "?"}{e?.branch ? ` · ${e.branch}` : ""}
                      <button type="button" aria-label={`${e?.name ?? "받는 사람"} 빼기`} onClick={() => setRecipients(r => r.filter(x => x !== id))} className="text-indigo-400 hover:text-indigo-600"><X size={12} /></button>
                    </span>
                  );
                })}
                {multiOn && recipients.length > 1 && <span className="self-center text-xs text-gray-500">총 {recipients.length}명</span>}
              </div>
            )}
          </div>

          <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
            <p><b>원장 자동</b> · 지점 메인 원장</p>
            <p><b>인사카드 값 자동</b> · 입사일·생년월일·주소</p>
            <p>사람마다 1건씩, 개인별 값은 다음 화면 표에서</p>
          </div>

          <button type="button" onClick={goCompose} disabled={!pick || !recipients.length}
            className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
            다음: 내용 입력
          </button>
          {(!pick || !recipients.length) && (
            <p className="text-[11px] text-gray-500 text-center">{!pick ? "서류를 고르면" : "받는 사람을 고르면"} 다음으로 넘어갈 수 있습니다</p>
          )}
          <p className="text-[11px] text-gray-500 border-t border-gray-100 pt-3">
            외부(미가입) 계약자 링크 서명·코디/외부 채용 패키지는 <Link href="/admin/contracts" className="text-indigo-600 underline">보낸 계약서</Link> → 「계약서 작성」에서 보냅니다.
          </p>
        </aside>
      </div>

      {/* 휴대폰·좁은 화면 — 오른쪽 패널이 양식 카드 맨 아래로 밀리므로, 서류를 고르면 아래에 고정 바를 띄운다 */}
      {pick && (
        <div className="lg:hidden fixed inset-x-0 md:left-64 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur" style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-gray-900">{pickedTitle}</p>
              <p className="truncate text-xs text-gray-500">{recipients.length ? `받는 사람 ${recipients.length}명` : "받는 사람을 고르세요"}</p>
            </div>
            {recipients.length ? (
              <button type="button" onClick={goCompose} className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-bold text-white">다음: 내용 입력</button>
            ) : (
              <button type="button" onClick={() => document.getElementById("send-panel")?.scrollIntoView({ behavior: "smooth" })}
                className="shrink-0 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium">받는 사람 고르기</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
