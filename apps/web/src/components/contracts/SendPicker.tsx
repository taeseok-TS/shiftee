"use client";

// 계약서 보내기 1단계 — 서류 고르기(2026-10-17 본부 박정인 님 개선 시안 1·2 → 2026-10-20 시안 v2 1·2·11번: 한 화면 3단계의 첫 단계).
//
// 두 화면이다.
//  ① 고르기: ★ 즐겨찾기 줄(서류·묶음) → 전체 서류(알약 용도 탭 · 카드 체크로 여러 장 · 카드를 포개면 묶음 · ⋮⋮ 로 순서 · 많이 쓴 순/내가 정한 순)
//  ② 보낼 준비: 들어 있는 서류(결재 순서·미리보기·이 묶음에서 빼기·끌어서 보내는 순서) + 받는 사람(한 명/여러 명) + 「n명 × m종 = k건」
// [다음: 내용 입력]을 누르면 같은 화면(ContractsScreen flow)의 2단계로 넘어가 「보낸 계약서」 작성 창과 같은 폼이 펼쳐진다 — 규칙 복제 없음.
// 즐겨찾기·묶음·순서는 본부 전체가 같이 본다(lib/contract-send-layout, /api/admin/contract-send-layout).
// 외부(미가입) 계약자·코디 채용 묶음·외부 채용 패키지도 여기서 고른다(2026-10-21 본부 이예지 재요청 F — 「같은 3단계 화면에서」).
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, GripVertical, Plus, Star, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { parseApprovalSteps, stepsLabel, templateStepsFor } from "@/lib/approval-order";
import { CONTRACT_PURPOSES, OTHER_PURPOSE, parsePurposeMap, purposesOf, type ContractPurpose } from "@/lib/contract-purpose";
import { RESIGN_DOC_LABELS, RESIGN_PICK_DEFAULT, findPackageTemplates } from "@/lib/contract-packages";
import { DEFAULT_LAYOUT, MAX_BUNDLES, MAX_BUNDLE_DOCS, MAX_FAVORITES, bundleProblem, isEmployeeOnlyDoc, normalizeLayout, type FavRef, type SendLayout } from "@/lib/contract-send-layout";

type Template = {
  id: string; name: string; description?: string | null; type: string; createdAt?: string; fileUrl?: string;
  postSignAccess?: string; approvalSteps?: unknown; approvalStepsRenewal?: unknown; pinned?: boolean;
};
type Employee = { id: string; name: string; branch?: string | null; department?: string | null; role?: string; position?: string | null; jobGroup?: string | null; hireDate?: string | null; resignDate?: string | null };
type PurposeKey = ContractPurpose | "other";
// 고른 서류 — 양식 하나, 신규입사 묶음, 퇴사 서류 고르기, 묶음(직접 만든 것 또는 이번만 고른 여러 장 — id 가 null 이면 저장 안 된 묶음).
// purpose 는 고를 때의 용도(재계약 탭에서 고르면 작성 폼의 계약 구분이 재계약)
export type Pick =
  | { kind: "tpl"; id: string; purpose: PurposeKey }
  | { kind: "hire" } | { kind: "resign" }
  | { kind: "bundle"; id: string | null; name: string; templateIds: string[] }
  | null;
/** 1단계에서 고른 것 — 2단계 작성 폼을 여는 값.
 *  external = 외부(미가입) 계약자에게(받는 사람 없이 2단계에서 이름·휴대폰), pack = 함께 보내는 묶음(codi = 코디 채용 3종, ext = 외부 채용 3종) */
export type SendSelection = { pick: NonNullable<Pick>; recipients: string[]; resignPicks: boolean[]; purpose: PurposeKey; multi: boolean; external?: boolean; pack?: "codi" | "ext" | null };

const ACCESS_LABEL: Record<string, string> = { full: "열람·다운로드", view: "열람만", none: "보관만" };
/** 카드에 쓰는 양식 이름 — 양식 관리의 이름 그대로(2026-10-28 이예지: 「코디 · 계약직 일반·오후」처럼 줄인 이름은 양식 관리와 달라 헷갈린다).
 *  함수는 호출부가 많아 남겨 둔다 */
export function displayTplName(name: string): string {
  return name.trim();
}
// 용도 탭 점 색(묶음마다 다른 색 — 시안 v2 톤 안내)
const PURPOSE_DOT: Record<string, string> = { recruit: "bg-rose-500", hire: "bg-indigo-500", renew: "bg-violet-500", resign: "bg-slate-500", leave: "bg-amber-600", other: "bg-gray-400" };

const kstMd = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(new Date(iso).getTime() + 9 * 3600 * 1000);
  if (isNaN(d.getTime())) return "";
  return `${d.getUTCMonth() + 1}/${String(d.getUTCDate()).padStart(2, "0")}`;
};

function DocThumb({ small }: { small?: boolean }) {
  return (
    <div className={cn("hidden sm:flex shrink-0 flex-col gap-1.5 rounded border border-gray-200 bg-white p-2", small ? "w-10 h-12" : "w-14 h-[70px]")} aria-hidden>
      <span className="h-0.5 w-6 bg-gray-700" />
      {[0, 1, 2].map(i => <span key={i} className="h-0.5 w-full bg-gray-200" />)}
    </div>
  );
}

// 묶음 id — 누를 때만 만든다(렌더 중에 부르지 않는다)
function newBundleId() { return `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; }

// 끌기 — 어떤 것을 끌고 있는지(카드 순서 바꾸기·카드 포개기·즐겨찾기 순서·묶음 안 순서·탭 순서)
type Drag = { kind: "reorder" | "stack"; id: string } | { kind: "fav"; key: string } | { kind: "doc"; id: string } | { kind: "tab"; key: string } | null;

export default function SendPicker({ initial, onNext, onTest, stepper }: {
  initial?: SendSelection | null;
  onNext: (sel: SendSelection) => void;
  onTest: (pick: Extract<NonNullable<Pick>, { kind: "tpl" }>) => void;
  stepper?: ReactNode;   // 「1 서류 고르기 — 2 내용 입력 — 3 결재자·발송」 표시(제목 오른쪽 위)
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [purposeMap, setPurposeMap] = useState<Record<string, ContractPurpose[]>>({});
  const [lastUsed, setLastUsed] = useState<Record<string, string>>({});
  const [usedCount, setUsedCount] = useState<Record<string, number>>({});
  const [layout, setLayout] = useState<SendLayout>(DEFAULT_LAYOUT);
  const [layoutOk, setLayoutOk] = useState(false);   // 서버 배치를 받았는가 — 못 받았으면 저장하지 않는다(기본값으로 본부 배치를 덮지 않게)
  const [loading, setLoading] = useState(true);
  // 양식 id → {#신규입사}/{#재계약} 구간이 있는가 — 재계약 순서는 이 구간이 있는 양식에만 쓰인다(작성 폼·발송과 같은 판정)
  const [hasKindCond, setHasKindCond] = useState<Record<string, boolean>>({});

  // 2·3단계에서 「이전」으로 돌아오면 고른 값이 그대로(initial)
  const [purpose, setPurpose] = useState<PurposeKey>(initial?.purpose ?? "hire");
  const [pick, setPick] = useState<Pick>(initial?.pick ?? null);
  const [resignPicks, setResignPicks] = useState<boolean[]>(initial?.resignPicks ?? [...RESIGN_PICK_DEFAULT]);
  const [multi, setMulti] = useState(initial?.multi ?? false);
  const [recipients, setRecipients] = useState<string[]>(initial?.recipients ?? []);
  const [toExt, setToExt] = useState(!!initial?.external);              // 받는 사람 = 외부(미가입) 계약자
  const [pack, setPack] = useState<"codi" | "ext" | null>(initial?.pack ?? null);   // 코디 채용 묶음·외부 채용 패키지
  const [search, setSearch] = useState("");
  const [checked, setChecked] = useState<string[]>([]);   // 전체 서류에서 체크한 양식(순서 = 체크한 순서)
  const [addOpen, setAddOpen] = useState(false);           // 「이 묶음에 서류 더 넣기」
  const drag = useRef<Drag>(null);
  const handleDown = useRef(false);                         // ⋮⋮ 손잡이에서 시작한 끌기인가(순서) — 아니면 카드 포개기(묶음)
  const [dropKey, setDropKey] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    Promise.all([
      fetch("/api/contract-templates").then(r => (r.ok ? r.json() : { templates: [] })).catch(() => ({ templates: [] })),
      fetch("/api/employees?includeAdmins=true").then(r => (r.ok ? r.json() : { employees: [] })).catch(() => ({ employees: [] })),
      fetch("/api/admin/contract-purposes").then(r => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ purposes?: unknown; lastUsed?: Record<string, string>; monthCount?: Record<string, number>; totalCount?: Record<string, number> }>,
      fetch("/api/admin/contract-send-layout", { cache: "no-store" }).then(r => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<{ layout?: unknown }>,
    ]).then(([t, e, p, l]) => {
      if (stop) return;
      setTemplates(t.templates || []);
      setEmployees(e.employees || []);
      setPurposeMap(parsePurposeMap(p.purposes));
      setLastUsed(p.lastUsed || {});
      setUsedCount(p.totalCount || p.monthCount || {});   // 전체 사용 횟수(이번 달은 전부 0건이라 — 이예지 10/28 디자인 ⑩)
      if (l.layout) { setLayout(normalizeLayout(l.layout)); setLayoutOk(true); }
      setLoading(false);
      const withRenewal = ((t.templates || []) as Template[]).filter(x => x.approvalStepsRenewal != null);
      Promise.all(withRenewal.map(x => fetch(`/api/contract-templates/${x.id}/fields`).then(r => (r.ok ? r.json() : {})).catch(() => ({}))
        .then((d: { conditions?: string[] }) => [x.id, (d.conditions || []).includes("신규입사")] as const)))
        .then(rows => { if (!stop) setHasKindCond(Object.fromEntries(rows)); });
    });
    return () => { stop = true; };
  }, []);

  // 배치 저장 — 화면은 먼저 바꾸고(낙관적) 서버에 통째로 저장. 실패하면 서버 값으로 되돌린다
  const saving = useRef(false);
  const saveLayout = async (next: SendLayout, okMsg?: string): Promise<SendLayout | null> => {
    if (!layoutOk) { toast.error("즐겨찾기·묶음 배치를 아직 불러오지 못했습니다. 새로고침한 뒤 다시 해 주세요."); return null; }
    if (saving.current) { toast.info("앞의 저장을 마치는 중입니다. 잠시 뒤 다시 해 주세요."); return null; }
    saving.current = true;
    const prev = layout;
    setLayout(next);
    try {
      const res = await fetch("/api/admin/contract-send-layout", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: next }) });
      const d = await res.json().catch(() => ({}));
      if (res.status === 409 && d.layout) { setLayout(normalizeLayout(d.layout)); toast.error(d.error || "다른 관리자가 방금 바꿨습니다. 다시 해 주세요."); return null; }
      if (!res.ok) throw new Error(d.error || "저장하지 못했습니다.");
      const saved = normalizeLayout(d.layout);
      setLayout(saved);
      if (okMsg) toast.success(okMsg);
      return saved;
    } catch (e) {
      setLayout(prev);
      toast.error(e instanceof Error ? e.message : "저장하지 못했습니다.");
      return null;
    } finally { saving.current = false; }
  };

  const tplOf = (id: string) => templates.find(t => t.id === id);
  const pkg = useMemo(() => findPackageTemplates(templates), [templates]);
  const purposeOfTpl = (t: Template) => purposesOf(t, purposeMap);
  const listFor = (k: PurposeKey) => templates.filter(t => {
    const ps = purposeOfTpl(t);
    return k === "other" ? ps.length === 0 : ps.includes(k);
  });
  const allTabs = [...CONTRACT_PURPOSES, OTHER_PURPOSE] as { key: PurposeKey; label: string; hint: string }[];
  const tabs = layout.purposeOrder.map(k => allTabs.find(t => t.key === k)).filter((t): t is (typeof allTabs)[number] => !!t)
    .filter(t => t.key !== "other" || listFor("other").length > 0);
  // 카드 순서 — 많이 쓴 순(전체 사용 횟수 → 최근 사용) 또는 내가 정한 순(tplOrder, 없는 것은 뒤에 많이 쓴 순)
  const usageSort = (a: Template, b: Template) => (usedCount[b.id] || 0) - (usedCount[a.id] || 0) || (lastUsed[b.id] || "").localeCompare(lastUsed[a.id] || "") || a.name.localeCompare(b.name);
  const ordered = (list: Template[]) => {
    if (layout.orderMode === "usage") return [...list].sort(usageSort);
    const pos = new Map(layout.tplOrder.map((id, i) => [id, i]));
    return [...list].sort((a, b) => (pos.get(a.id) ?? 1e6) - (pos.get(b.id) ?? 1e6) || usageSort(a, b));
  };
  const list = ordered(listFor(purpose));

  const isFav = (ref: FavRef) => layout.favorites.some(f => f.t === ref.t && f.id === ref.id);
  const toggleFav = (ref: FavRef) => {
    const on = isFav(ref);
    if (!on && layout.favorites.length >= MAX_FAVORITES) { toast.error(`즐겨찾기는 ${MAX_FAVORITES}개까지입니다.`); return; }
    void saveLayout({ ...layout, favorites: on ? layout.favorites.filter(f => !(f.t === ref.t && f.id === ref.id)) : [...layout.favorites, ref] });
  };

  const stepsOf = (t: Template, renewCard: boolean) =>
    stepsLabel(parseApprovalSteps(templateStepsFor(t, renewCard && t.approvalStepsRenewal != null && hasKindCond[t.id] === true)));
  const hireDocs = [pkg.empTemplate, pkg.privacyTemplate].filter(Boolean) as Template[];

  // ── 받는 사람 ──
  // 재계약 · 연봉 서류는 퇴사 예정자(퇴사일이 정해진 사람)를 처음부터 받는 사람 후보에서 뺀다(2026-10-29 이예지 — 박선재 10/30 퇴사)
  const renewing = (pick?.kind === "tpl" ? pick.purpose : purpose) === "renew";
  const candidates = employees.filter(e => e.role !== "ADMIN" && !(renewing && e.resignDate));
  const q = search.trim().toLowerCase();
  const found = q ? candidates.filter(e => e.name.toLowerCase().includes(q) || (e.branch || "").toLowerCase().includes(q) || (e.department || "").toLowerCase().includes(q)).slice(0, 30) : [];
  const empOf = (id: string) => employees.find(e => e.id === id);
  // 퇴사 서류는 한 명씩만(작성 폼이 퇴사 패키지 여러 명 작성을 막는다 — 상태 꼬임 사고, 2026-08-26 검증)
  // 함께 보내는 문서(비밀유지서약서·개인정보동의서) — 작성 폼과 같은 탐색(사본·[채용]·퇴직용 빼고 최근 등록 먼저)
  const companions = useMemo(() => {
    const pool = templates.filter(t => !/\(사본( \d+)?\)/.test(t.name)).sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || ""));
    const nda = pool.find(t => t.name.includes("비밀유지") && !t.name.includes("퇴직") && !t.name.includes("[채용]"));
    const privacy = pool.find(t => t.name.includes("개인정보") && !t.name.includes("[채용]"));
    return nda && privacy ? [nda, privacy] : null;
  }, [templates]);
  const pickedTpl = pick?.kind === "tpl" ? tplOf(pick.id) : undefined;
  const isCopy = (n: string) => /\(사본( \d+)?\)/.test(n);
  // 작성 폼이 실제로 쓰는 양식과 같을 때만 묶음을 권한다 — 사본은 빼고, 외부 채용 패키지는 가장 최근 등록한 기타직무 계약서(검증 P2)
  const extMain = useMemo(() => templates.filter(t => t.name.includes("기타직무") && !/\(사본( \d+)?\)/.test(t.name)).sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || ""))[0], [templates]);
  const isCodiTpl = !!pickedTpl && pickedTpl.name.includes("코디") && pickedTpl.name.includes("근로계약서") && !isCopy(pickedTpl.name);
  const isExtTpl = !!pickedTpl && !!extMain && pickedTpl.id === extMain.id;
  const packOn = pack === "codi" ? isCodiTpl && !toExt && !!companions : pack === "ext" ? isExtTpl && toExt && !!companions : false;
  const multiAllowed = pick?.kind !== "resign" && !toExt && !(pack === "codi" && packOn);   // 퇴사 서류·외부 계약자·코디 채용 묶음은 한 명씩
  const multiOn = multi && multiAllowed;
  const toggleRecipient = (id: string) => {
    // 원장을 고르면 한 번 묻는다(2026-10-28 이예지 ⑤ — 원장도 근로계약서 받는 사람으로 그냥 골라졌다)
    const e0 = empOf(id);
    if (e0?.role === "MANAGER" && !recipients.includes(id) && !confirm(`${e0.name} 님은 원장입니다. 원장님께 보내는 서류가 맞나요?`)) return;
    setRecipients(prev => {
      if (!multiOn) return prev[0] === id ? [] : [id];
      return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
    });
    if (!multiOn) setSearch("");
  };

  // ── 고르기 ──
  const choose = (p: Pick) => {
    setPick(p);
    setAddOpen(false);
    setToExt(false); setPack(null);   // 외부·묶음 선택은 고른 서류마다 새로
    if (p?.kind === "resign") {
      setResignPicks([...RESIGN_PICK_DEFAULT]);
      if (recipients.length > 1) { setRecipients(r => r.slice(0, 1)); toast.info("퇴사 서류는 한 명씩 보냅니다. 첫 번째 받는 사람만 남겼습니다."); }
    }
    window.scrollTo({ top: 0 });
  };
  const chooseFav = (f: FavRef) => {
    if (f.t === "hire") { if (!pkg.canBundle) { toast.error("신규입사 묶음 양식이 다 등록돼 있지 않습니다(양식 관리에서 확인)."); return; } choose({ kind: "hire" }); return; }
    if (f.t === "resign") { if (!pkg.canResignBundle) { toast.error("퇴사 서류 양식이 다 등록돼 있지 않습니다."); return; } choose({ kind: "resign" }); return; }
    if (f.t === "bundle") { const b = layout.bundles.find(x => x.id === f.id); if (b) choose({ kind: "bundle", id: b.id, name: b.name, templateIds: b.templateIds }); return; }
    const t = tplOf(f.id);
    if (t) { const ps = purposeOfTpl(t); choose({ kind: "tpl", id: t.id, purpose: (ps[0] as PurposeKey) ?? "other" }); }
  };
  const sendChecked = () => {
    const ids = checked.filter(id => tplOf(id));
    if (!ids.length) return;
    if (ids.length === 1) choose({ kind: "tpl", id: ids[0], purpose });
    else choose({ kind: "bundle", id: null, name: `고른 서류 ${ids.length}종`, templateIds: ids.slice(0, MAX_BUNDLE_DOCS) });
    setChecked([]);
  };
  const saveBundle = (ids: string[], suggest: string) => {
    const uniqIds = [...new Set(ids)].filter(id => tplOf(id));
    if (uniqIds.length < 2) { toast.error("묶음은 서류 2종 이상이어야 합니다."); return; }
    if (uniqIds.length > MAX_BUNDLE_DOCS) { toast.error(`묶음에는 ${MAX_BUNDLE_DOCS}종까지 넣을 수 있습니다.`); return; }
    if (layout.bundles.length >= MAX_BUNDLES) { toast.error(`묶음은 ${MAX_BUNDLES}개까지입니다. 안 쓰는 묶음을 지운 뒤 만들어 주세요.`); return; }
    const bp = bundleProblem(uniqIds.map(id => tplOf(id)!).filter(Boolean));
    if (bp) { toast.error(bp, { duration: 9000 }); return; }
    const name = window.prompt("묶음 이름을 정해 주세요(예: 교실장 승진 묶음)", suggest)?.trim().slice(0, 40);
    if (!name) return;
    const id = newBundleId();
    const favRoom = layout.favorites.length < MAX_FAVORITES;
    const favs = favRoom ? [...layout.favorites, { t: "bundle" as const, id }] : layout.favorites;
    void saveLayout({ ...layout, bundles: [...layout.bundles, { id, name, templateIds: uniqIds }], favorites: favs },
      favRoom ? `「${name}」 묶음을 만들고 즐겨찾기에 올렸습니다.` : `「${name}」 묶음을 만들었습니다(즐겨찾기가 가득 차 「내 묶음」에 있습니다).`);
    setChecked([]);
  };
  const deleteBundle = (id: string) => {
    const b = layout.bundles.find(x => x.id === id);
    if (!b || !window.confirm(`「${b.name}」 묶음을 지울까요? 서류(양식)는 지워지지 않습니다.`)) return;
    void saveLayout({ ...layout, bundles: layout.bundles.filter(x => x.id !== id), favorites: layout.favorites.filter(f => !(f.t === "bundle" && f.id === id)) }, "묶음을 지웠습니다.");
    if (pick?.kind === "bundle" && pick.id === id) setPick(null);
  };
  // 보낼 준비 화면에서 묶음 구성을 바꾼다 — 저장된 묶음이면 그 묶음에도 저장(시안: 바꾼 내용은 「묶음」에 저장돼요)
  const updatePickedBundle = (ids: string[]) => {
    if (pick?.kind !== "bundle") return;
    if (ids.length === 0) { setPick(null); return; }
    if (ids.length === 1) { choose({ kind: "tpl", id: ids[0], purpose }); return; }   // 한 장만 남으면 서류 한 장 보내기
    { const bp = bundleProblem(ids.map(id => tplOf(id)!).filter(Boolean)); if (bp) { toast.error(bp, { duration: 9000 }); return; } }   // 결재 순서가 다른 서류는 넣지 않는다
    setPick({ ...pick, templateIds: ids });
    if (pick.id) {
      const bid = pick.id;
      const bundles = layout.bundles.map(b => (b.id === bid ? { ...b, templateIds: ids } : b));
      void saveLayout({ ...layout, bundles }).then((saved) => {
        if (saved && !saved.bundles.some(b => b.id === bid)) setPick(p => (p?.kind === "bundle" && p.id === bid ? { ...p, id: null } : p));
      });
    }
  };

  // ── 끌기 ──
  const moveBefore = <T,>(arr: T[], from: number, to: number) => { const a = [...arr]; const [x] = a.splice(from, 1); a.splice(to > from ? to - 1 : to, 0, x); return a; };
  const onCardDrop = (targetId: string) => {
    const d = drag.current; drag.current = null; setDropKey(null);
    if (!d || (d.kind !== "reorder" && d.kind !== "stack") || d.id === targetId) return;
    if (d.kind === "stack") { saveBundle([targetId, d.id], `${displayTplName(tplOf(targetId)?.name ?? "새")} 묶음`); return; }
    // 순서 바꾸기 — 지금 보이는 순서를 기준으로 「내가 정한 순」을 만든다(다른 용도 탭의 순서는 그대로)
    const visible = list.map(t => t.id);
    const base = [...visible, ...layout.tplOrder.filter(id => !visible.includes(id))];
    const from = base.indexOf(d.id), to = base.indexOf(targetId);
    if (from < 0 || to < 0) return;
    void saveLayout({ ...layout, orderMode: "manual", tplOrder: moveBefore(base, from, to) });
  };
  const favKey = (f: FavRef) => `${f.t}:${f.id}`;
  const onFavDrop = (target: FavRef) => {
    const d = drag.current; drag.current = null; setDropKey(null);
    if (!d || d.kind !== "fav") return;
    const from = layout.favorites.findIndex(f => favKey(f) === d.key), to = layout.favorites.findIndex(f => favKey(f) === favKey(target));
    if (from < 0 || to < 0 || from === to) return;
    void saveLayout({ ...layout, favorites: moveBefore(layout.favorites, from, to) });
  };
  const onTabDrop = (targetKey: string) => {
    const d = drag.current; drag.current = null; setDropKey(null);
    if (!d || d.kind !== "tab") return;
    const from = layout.purposeOrder.indexOf(d.key), to = layout.purposeOrder.indexOf(targetKey);
    if (from < 0 || to < 0 || from === to) return;
    void saveLayout({ ...layout, purposeOrder: moveBefore(layout.purposeOrder, from, to) });
  };

  // ── 다음 ──
  const goCompose = () => {
    if (!pick) { toast.error("보낼 서류를 먼저 고르세요."); return; }
    // 외부 계약자 — 받는 사람은 2단계에서 이름·휴대폰으로(받을 이메일은 3단계에서)
    if (toExt && pick.kind === "tpl") { onNext({ pick, recipients: [], resignPicks, purpose, multi: false, external: true, pack: packOn ? "ext" : null }); return; }
    if (!recipients.length) { toast.error("받는 사람을 고르세요."); return; }
    if (packOn && pack === "codi") { onNext({ pick, recipients: recipients.slice(0, 1), resignPicks, purpose, multi: false, pack: "codi" }); return; }
    if (pick.kind === "bundle") { const bp = bundleProblem(pickedDocs); if (bp) { toast.error(bp, { duration: 9000 }); return; } }
    onNext({ pick, recipients: multiOn ? recipients : recipients.slice(0, 1), resignPicks, purpose, multi: multiOn });
  };
  const goTest = () => {
    if (pick?.kind !== "tpl") { toast.error("테스트 발송은 서류 한 장을 고른 뒤에 할 수 있습니다(묶음은 테스트 발송이 없습니다)."); return; }
    onTest(pick);
  };

  // 보낼 준비 화면의 서류 목록
  const pickedDocs: Template[] = !pick ? []
    : pick.kind === "tpl" ? [tplOf(pick.id)].filter(Boolean) as Template[]
    : pick.kind === "hire" ? hireDocs
    : pick.kind === "resign" ? (pkg.resignTemplates.filter((t, i) => !!t && (i === 0 || resignPicks[i])) as Template[])
    : pick.templateIds.map(id => tplOf(id)).filter(Boolean) as Template[];
  const pickTitle = !pick ? "" : pick.kind === "hire" ? "신규입사 묶음" : pick.kind === "resign" ? "퇴사 서류" : pick.kind === "bundle" ? pick.name : displayTplName(tplOf(pick.id)?.name ?? "");
  const nDocs = pickedDocs.length + (packOn ? 2 : 0);
  const nPeople = multiOn ? recipients.length : Math.min(recipients.length, 1);

  // ── 카드 ──
  const favCard = (f: FavRef, i: number) => {
    const b = f.t === "bundle" ? layout.bundles.find(x => x.id === f.id) : undefined;
    const t = f.t === "tpl" ? tplOf(f.id) : undefined;
    const name = f.t === "hire" ? "신규입사 묶음" : f.t === "resign" ? "퇴사 서류" : b?.name ?? (t ? displayTplName(t.name) : "");
    if (!name) return null;
    const docs = f.t === "hire" ? hireDocs.map(d => displayTplName(d.name)) : f.t === "resign" ? ["사직원", "비밀유지서약서(퇴직시)", "+ 필요할 때 3종"] : b ? b.templateIds.map(id => tplOf(id)?.name).filter(Boolean).map(n => displayTplName(n as string)) : [];
    const favSub = docs.length ? docs.join(" · ") : (t?.description || "");
    const count = f.t === "tpl" ? (usedCount[f.id] || 0) : f.t === "bundle" && b ? Math.max(0, ...b.templateIds.map(id => usedCount[id] || 0)) : f.t === "hire" && pkg.empTemplate ? (usedCount[pkg.empTemplate.id] || 0) : 0;
    const k = favKey(f);
    return (
      <div key={k} draggable onDragStart={(e) => { drag.current = { kind: "fav", key: k }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "x"); }}
        onDragOver={(e) => { if (drag.current?.kind === "fav") { e.preventDefault(); setDropKey(`fav:${k}`); } }}
        onDragLeave={() => setDropKey(null)} onDrop={(e) => { e.preventDefault(); onFavDrop(f); }}
        className={cn("group rounded-xl border bg-white p-4 flex flex-col gap-2 min-w-0", dropKey === `fav:${k}` ? "border-indigo-400 ring-2 ring-indigo-200" : "border-gray-200")}>
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => toggleFav(f)} title="즐겨찾기에서 빼기" className="text-amber-400 hover:text-amber-500 shrink-0 mt-0.5"><Star size={16} fill="currentColor" /></button>
          <p className="flex-1 min-w-0 font-bold text-gray-900 leading-snug break-keep">{name}</p>
          {docs.length > 1 && <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[12px] font-semibold text-amber-700">{f.t === "resign" ? "2~5종" : `${docs.length}종`}</span>}
          <GripVertical size={14} className="shrink-0 text-gray-300 group-hover:text-gray-400 cursor-grab" aria-label="끌어서 순서 바꾸기" />
        </div>
        {/* 이름은 위 한 줄 굵게, 설명은 둘째 줄 회색 두 줄까지(잘리면 title 로 전체) */}
        <p className="text-xs text-gray-500 line-clamp-2 break-keep" title={favSub || undefined}>{favSub || " "}{count ? ` · 전체 ${count}건` : ""}</p>
        <div className="mt-auto flex gap-2">
          <button type="button" onClick={() => chooseFav(f)}
            className={cn("flex-1 rounded-lg py-2 text-sm font-semibold border", i === 0 ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700" : "bg-white text-indigo-700 border-indigo-200 hover:bg-indigo-50")}>보내기</button>
          {b && <button type="button" onClick={() => deleteBundle(b.id)} title="묶음 지우기" className="rounded-lg border border-gray-200 px-2 text-xs text-gray-400 hover:text-rose-600">지우기</button>}
        </div>
      </div>
    );
  };

  const tplCard = (t: Template) => {
    const on = checked.includes(t.id);
    const fav = isFav({ t: "tpl", id: t.id });
    const used = lastUsed[t.id];
    const n = usedCount[t.id] || 0;
    return (
      <div key={t.id} draggable
        onDragStart={(e) => { drag.current = { kind: handleDown.current ? "reorder" : "stack", id: t.id }; handleDown.current = false; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "x"); }}
        onDragEnd={() => { drag.current = null; setDropKey(null); handleDown.current = false; }}
        onDragOver={(e) => { const d = drag.current; if ((d?.kind === "reorder" || d?.kind === "stack") && d.id !== t.id) { e.preventDefault(); setDropKey(`tpl:${t.id}:${d.kind}`); } }}
        onDragLeave={() => setDropKey(null)} onDrop={(e) => { e.preventDefault(); onCardDrop(t.id); }}
        className={cn("rounded-xl border bg-white p-3 flex gap-3 items-start transition-colors",
          on ? "border-indigo-400 bg-indigo-50/30" : "border-gray-200",
          dropKey === `tpl:${t.id}:stack` && "ring-2 ring-amber-300 border-amber-400",
          dropKey === `tpl:${t.id}:reorder` && "ring-2 ring-indigo-200 border-indigo-400")}>
        <span onPointerDown={() => { handleDown.current = true; }} onPointerUp={() => { handleDown.current = false; }}
          className="self-center text-gray-300 hover:text-gray-500 cursor-grab" title="끌어서 순서 바꾸기" aria-label="끌어서 순서 바꾸기"><GripVertical size={16} /></span>
        <input type="checkbox" checked={on} onChange={() => setChecked(c => (c.includes(t.id) ? c.filter(x => x !== t.id) : [...c, t.id]))}
          className="mt-1 h-4 w-4 accent-indigo-600 shrink-0" aria-label={`${t.name} 고르기`} />
        <DocThumb />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start gap-2">
            <button type="button" onClick={() => choose({ kind: "tpl", id: t.id, purpose })} title={t.name !== displayTplName(t.name) ? t.name : undefined}
              className="flex-1 min-w-0 text-left font-bold text-gray-900 leading-snug break-keep hover:text-indigo-700">
              {displayTplName(t.name)}
            </button>
            <button type="button" onClick={() => toggleFav({ t: "tpl", id: t.id })} title={fav ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}
              className={cn("shrink-0", fav ? "text-amber-400" : "text-gray-200 hover:text-amber-300")}><Star size={18} fill="currentColor" /></button>
          </div>
          {/* 설명은 이름 아래 둘째 줄 회색, 두 줄까지(잘리면 title 로 전체 — 2026-10-23 본부 요청 ■3) */}
          {t.description && <p className="text-xs text-gray-500 line-clamp-2 break-keep" title={t.description}>{t.description}</p>}
          <p className="text-xs text-gray-700">결재 {stepsOf(t, purpose === "renew")}</p>
          {/* 「근로자 열람·다운로드」는 기본값이라 쓰지 않는다 — 열람만 · 보관만일 때만 표시 */}
          <p className="text-[12px] text-gray-500">{used ? `최근 ${kstMd(used)}` : `등록 ${kstMd(t.createdAt)}`}{` · 전체 ${n}건`}{t.postSignAccess && t.postSignAccess !== "full" && ACCESS_LABEL[t.postSignAccess] ? ` · 근로자 ${ACCESS_LABEL[t.postSignAccess]}` : ""}</p>
        </div>
      </div>
    );
  };

  const customNonFav = layout.bundles.filter(b => !isFav({ t: "bundle", id: b.id }));
  const pkgCard = (kind: "hire" | "resign") => {
    const can = kind === "hire" ? pkg.canBundle : pkg.canResignBundle;
    const ref: FavRef = { t: kind, id: kind };
    const fav = isFav(ref);
    return (
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/30 p-3 flex gap-3 items-start">
        <DocThumb />
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start gap-2">
            <p className="flex-1 min-w-0 font-bold text-gray-900 leading-snug">
              {kind === "hire" ? "신규입사 묶음" : "퇴사 서류"} <span className="text-xs font-semibold text-amber-700">{kind === "hire" ? `${hireDocs.length}종` : "2~5종"}</span>
            </p>
            <button type="button" onClick={() => toggleFav(ref)} title={fav ? "즐겨찾기에서 빼기" : "즐겨찾기에 넣기"}
              className={cn("shrink-0", fav ? "text-amber-400" : "text-gray-200 hover:text-amber-300")}><Star size={18} fill="currentColor" /></button>
          </div>
          <p className="text-xs text-gray-600">{kind === "hire" ? hireDocs.map(d => displayTplName(d.name)).join(" · ") : "사직원 · 비밀유지서약서(퇴직시) + 필요할 때 금품청산·퇴직금·연차수당"}</p>
          {!can && <p className="text-xs text-rose-600">묶음에 들어갈 양식이 다 등록돼 있지 않습니다(양식 관리에서 확인).</p>}
          <button type="button" disabled={!can} onClick={() => chooseFav(ref)}
            className="mt-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">보내기</button>
        </div>
      </div>
    );
  };
  const header = (title: string, sub?: ReactNode) => (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p className="text-xs text-gray-500">전자계약 › 계약서 보내기{pick ? ` › ${pickTitle}` : ""}</p>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {sub}
      </div>
      {stepper}
    </div>
  );

  // ══ ② 보낼 준비 ══
  if (pick) {
    const isBundle = pick.kind === "bundle";
    const editable = isBundle;
    const orderDocs = (from: number, to: number) => { if (pick.kind === "bundle") updatePickedBundle(moveBefore(pick.templateIds, from, to)); };
    const addables = templates.filter(t => !pickedDocs.some(d => d.id === t.id));
    return (
      <div className={cn("space-y-5", "pb-24 lg:pb-0")}>
        {header(`${pickTitle} 보내기`, (
          <div className="mt-1 flex gap-3 text-xs">
            <button type="button" onClick={() => setPick(null)} className="text-gray-500 underline hover:text-indigo-600">← 다른 서류 고르기</button>
            {pick.kind === "tpl" && <button type="button" onClick={goTest} className="text-gray-500 underline hover:text-indigo-600">나에게 테스트 발송</button>}
            {isBundle && !pick.id && <button type="button" onClick={() => saveBundle(pick.templateIds, "새 묶음")} className="text-gray-500 underline hover:text-indigo-600">이 구성을 묶음으로 저장</button>}
          </div>
        ))}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
          <div className="space-y-3 min-w-0">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-900">들어 있는 서류 <span className="text-sm font-normal text-gray-500">· {nDocs}종</span></h2>
              {editable && <span className="text-xs text-gray-400">⋮⋮ 끌어서 보내는 순서 변경</span>}
            </div>
            {pick.kind === "resign" && (
              <div className="rounded-xl border bg-white p-3 flex flex-wrap gap-1.5">
                {RESIGN_DOC_LABELS.map((label, i) => (
                  <label key={label} className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs",
                    (i === 0 || resignPicks[i]) ? "border-indigo-300 bg-indigo-50 text-indigo-800" : "border-gray-200 bg-white text-gray-500", i === 0 ? "opacity-80" : "cursor-pointer")}>
                    <input type="checkbox" className="h-3 w-3" checked={i === 0 || resignPicks[i]} disabled={i === 0}
                      onChange={e => setResignPicks(p => p.map((v, j) => (j === i ? e.target.checked : v)))} />
                    {label}
                  </label>
                ))}
                <span className="w-full text-[12px] text-gray-500">사직원은 늘 들어가고, 근속 1년 미만이면 퇴직금 정산 신청서는 자동으로 빠집니다.</span>
              </div>
            )}
            {pickedDocs.map((d, i) => (
              <div key={d.id} draggable={editable}
                onDragStart={(e) => { if (!editable) return; drag.current = { kind: "doc", id: d.id }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "x"); }}
                onDragOver={(e) => { if (drag.current?.kind === "doc" && drag.current.id !== d.id) { e.preventDefault(); setDropKey(`doc:${d.id}`); } }}
                onDragLeave={() => setDropKey(null)}
                onDrop={(e) => {
                  e.preventDefault(); const dd = drag.current; drag.current = null; setDropKey(null);
                  if (dd?.kind !== "doc" || pick.kind !== "bundle") return;
                  orderDocs(pick.templateIds.indexOf(dd.id), pick.templateIds.indexOf(d.id));
                }}
                className={cn("rounded-xl border bg-white p-4 flex gap-4", dropKey === `doc:${d.id}` ? "border-indigo-400 ring-2 ring-indigo-200" : "border-gray-200")}>
                {editable && <span className="self-center text-gray-300 cursor-grab" aria-label="끌어서 순서 바꾸기"><GripVertical size={16} /></span>}
                <DocThumb />
                <div className="flex-1 min-w-0 space-y-1.5">
                  <p className="font-bold text-gray-900 break-keep" title={d.name !== displayTplName(d.name) ? d.name : undefined}><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-50 text-[11px] text-indigo-700">{i + 1}</span>{displayTplName(d.name)}</p>
                  {d.description && <p className="text-xs text-gray-500">{d.description}</p>}
                  <dl className="grid grid-cols-[72px_1fr] gap-y-1 text-sm">
                    <dt className="text-gray-500">결재 순서</dt><dd className="font-semibold text-gray-900">{isBundle && isEmployeeOnlyDoc(d) ? "근로자만 서명" : stepsOf(d, purpose === "renew" || (pick.kind === "tpl" && pick.purpose === "renew"))}</dd>
                    <dt className="text-gray-500">근로자</dt><dd className="font-semibold text-gray-900">{ACCESS_LABEL[d.postSignAccess || "full"] ?? ACCESS_LABEL.full}</dd>
                  </dl>
                  <div className="flex gap-2 pt-1">
                    {d.fileUrl && <a href={`/api/docs/pdf?src=${encodeURIComponent(d.fileUrl)}`} target="_blank" rel="noreferrer" className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50">미리보기</a>}
                    {editable && <button type="button" onClick={() => pick.kind === "bundle" && updatePickedBundle(pick.templateIds.filter(x => x !== d.id))} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50">이 묶음에서 빼기</button>}
                  </div>
                </div>
              </div>
            ))}
            {editable && (
              <div className="text-xs text-gray-500">
                {!addOpen ? (
                  <button type="button" onClick={() => setAddOpen(true)} className="inline-flex items-center gap-1 hover:text-indigo-600"><Plus size={13} />이 묶음에 서류 더 넣기</button>
                ) : (
                  <select autoFocus className="rounded-md border px-2 py-1.5 text-sm" defaultValue=""
                    onChange={(e) => { const id = e.target.value; setAddOpen(false); if (id && pick.kind === "bundle") { if (pick.templateIds.length >= MAX_BUNDLE_DOCS) { toast.error(`묶음에는 ${MAX_BUNDLE_DOCS}종까지입니다.`); return; } updatePickedBundle([...pick.templateIds, id]); } }}>
                    <option value="">넣을 서류 고르기</option>
                    {addables.map(t => <option key={t.id} value={t.id}>{displayTplName(t.name)}</option>)}
                  </select>
                )}
                {pick.kind === "bundle" && pick.id ? <span className="ml-2">· 바꾼 내용은 「{pick.name}」에 저장돼요</span> : <span className="ml-2">· 이번 보내기에만 쓰는 구성입니다</span>}
              </div>
            )}
          </div>

          {/* 오른쪽 — 받는 사람 */}
          <aside id="send-panel" className="scroll-mt-4 rounded-xl border border-gray-200 bg-white p-4 space-y-4 lg:sticky lg:top-4">
            <p className="font-semibold text-gray-900">받는 사람</p>
            {/* 직원 / 외부(미가입) 계약자 — 서류 한 장을 골랐을 때만(묶음·신규입사·퇴사는 직원에게만) */}
            {pick.kind === "tpl" && (
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="받는 사람 종류">
                {([[false, "직원"], [true, "외부 계약자"]] as const).map(([v, label]) => (
                  <button key={String(v)} type="button" role="radio" aria-checked={toExt === v}
                    title={v ? "큐브티에 가입하지 않은 사람 — 링크로 서명합니다" : undefined}
                    onClick={() => { setToExt(v); setPack(null); if (v) setMulti(false); }}
                    className={cn("rounded-lg border py-2.5 text-sm font-semibold",
                      toExt === v ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50")}>
                    {label}
                  </button>
                ))}
              </div>
            )}
            {/* 함께 보내는 묶음 — 코디 계약서는 코디 채용 묶음, 기타직무 계약서를 외부 계약자에게면 외부 채용 패키지 */}
            {companions && ((isCodiTpl && !toExt) || (isExtTpl && toExt)) && (
              <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-2.5 text-sm text-gray-800">
                <input type="checkbox" className="mt-0.5" checked={pack === (isCodiTpl ? "codi" : "ext")}
                  onChange={(e) => { const k = isCodiTpl ? "codi" : "ext"; setPack(e.target.checked ? k : null); if (e.target.checked && k === "codi") { setMulti(false); setRecipients(r => r.slice(0, 1)); } }} />
                <span>
                  <b>{isCodiTpl ? "코디 채용 묶음으로" : "외부 채용 패키지로"}</b> — {companions.map(t => displayTplName(t.name)).join(" · ")} 함께(3종)
                  <span className="block text-[12px] text-gray-500">{isCodiTpl ? "비밀유지·개인정보동의서는 직원 서명만 받습니다. 한 명씩 보냅니다." : "외부 계약자는 링크 하나로 3종을 확인하고 한 번에 서명합니다."}</span>
                </span>
              </label>
            )}
            {toExt && pick.kind === "tpl" ? (
              <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
                <p className="font-semibold text-gray-900">외부 계약자 1명 · {nDocs}종</p>
                <p>이름·휴대폰은 다음 단계(내용 입력)에서, 계약서를 받을 이메일은 마지막 단계(결재자·발송)에서 넣습니다.</p>
                <p>보내면 서명 링크가 나옵니다 — 복사하거나 폰에서 문자로 전달합니다(가입 없이 서명).</p>
              </div>
            ) : (<>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="받는 사람 수">
              {([[false, "한 명"], [true, multiOn && recipients.length > 1 ? `여러 명 (${recipients.length})` : "여러 명"]] as const).map(([v, label]) => {
                const on = multiOn === v;
                const dis = v && !multiAllowed;
                return (
                  <button key={String(v)} type="button" role="radio" aria-checked={on} disabled={dis}
                    title={dis ? (pick.kind === "resign" ? "퇴사 서류는 한 명씩 보냅니다" : "코디 채용 묶음은 한 명씩 보냅니다") : v ? "같은 서류를 여러 명에게 — 사람마다 1건씩 만들어집니다" : undefined}
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
                        {/* 직무 · 입사일(2026-10-28 이예지 ⑤) */}
                        {(e.position || e.jobGroup) && <span className="text-xs text-gray-400">· {e.position || e.jobGroup}</span>}
                        {e.hireDate && <span className="text-xs text-gray-400">· 입사 {String(e.hireDate).slice(0, 10)}</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {recipients.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {(multiOn ? recipients : recipients.slice(0, 1)).map(id => {
                  const e = empOf(id);
                  return (
                    <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-50 border border-indigo-200 px-2.5 py-1 text-xs text-indigo-800">
                      {e?.name ?? "?"}{e?.branch ? ` · ${e.branch}` : ""}
                      <button type="button" aria-label={`${e?.name ?? "받는 사람"} 빼기`} onClick={() => setRecipients(r => r.filter(x => x !== id))} className="text-indigo-400 hover:text-indigo-800"><X size={12} /></button>
                    </span>
                  );
                })}
              </div>
            )}
            <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-700 space-y-1">
              {nPeople > 0 && <p className="font-semibold text-gray-900">{nPeople}명 × {nDocs}종 = {nPeople * nDocs}건이 한 번에 나갑니다</p>}
              <p>원장 자동 · 지점 메인 원장 · 인사카드 값 자동</p>
            </div>
            </>)}
            <button type="button" onClick={goCompose} disabled={(!toExt && !recipients.length) || nDocs === 0}
              className="w-full rounded-lg bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-40">
              다음: 내용 입력{toExt ? " (외부 계약자)" : nPeople > 0 ? ` (${nPeople}명 · ${nPeople * nDocs}건)` : ""}
            </button>
            {!toExt && !recipients.length && <p className="text-[12px] text-gray-500 text-center">받는 사람을 고르면 다음으로 넘어갈 수 있습니다</p>}
          </aside>
        </div>
      </div>
    );
  }

  // ══ ① 고르기 ══
  return (
    <div className={cn("space-y-6", checked.length > 0 && "pb-28")}>
      {header("어떤 서류를 보내시나요?", (
        <div className="mt-1 flex gap-3 text-xs">
          <Link href="/admin/contracts" className="text-gray-500 underline hover:text-indigo-600">보낸 계약서</Link>
        </div>
      ))}

      {/* ★ 즐겨찾기 — 서류 한 장도, 묶음도 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">즐겨찾기</h2>
          <span className="text-xs text-gray-400">서류 한 장도, 묶음도 ★ 로 모아 둬요 · 끌어서 순서 변경</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {loading ? <p className="rounded-xl border bg-white p-4 text-sm text-gray-400">불러오는 중…</p> : layout.favorites.map(favCard)}
          <div className="rounded-xl border border-dashed border-indigo-200 bg-white p-4 flex flex-col justify-center gap-1">
            <button type="button" onClick={() => checked.length >= 2 ? saveBundle(checked, "새 묶음") : toast.info("아래 전체 서류에서 2종 이상 체크한 뒤 누르세요. 카드를 다른 카드 위로 끌어 포개도 묶음이 됩니다.")}
              className="text-left font-bold text-indigo-600 inline-flex items-center gap-1"><Plus size={16} />묶음 만들기</button>
            <p className="text-xs text-gray-500">서류를 체크해 저장 · 카드끼리 포개도 돼요</p>
          </div>
        </div>
        {customNonFav.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1 text-xs">
            <span className="text-gray-400 self-center">내 묶음</span>
            {customNonFav.map(b => (
              <span key={b.id} className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1">
                <button type="button" onClick={() => chooseFav({ t: "bundle", id: b.id })} className="hover:text-indigo-700">{b.name} · {b.templateIds.length}종</button>
                <button type="button" onClick={() => toggleFav({ t: "bundle", id: b.id })} title="즐겨찾기에 넣기" className="text-gray-300 hover:text-amber-400"><Star size={12} fill="currentColor" /></button>
                <button type="button" onClick={() => deleteBundle(b.id)} title="묶음 지우기" className="text-gray-300 hover:text-rose-500"><X size={12} /></button>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 전체 서류 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-gray-900">전체 서류</h2>
          <div className="flex items-center gap-3 text-xs">
            <span className="text-gray-400">⋮⋮ 끌어서 순서 변경 · 카드끼리 포개면 묶음</span>
            <div className="flex rounded-lg border bg-white p-0.5">
              {([["usage", "많이 쓴 순"], ["manual", "내가 정한 순"]] as const).map(([v, label]) => (
                <button key={v} type="button" onClick={() => layout.orderMode !== v && void saveLayout({ ...layout, orderMode: v })}
                  className={cn("rounded-md px-2.5 py-1", layout.orderMode === v ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50")}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        {/* 용도 탭 — 작은 알약(카드와 헷갈리지 않게). 끌어서 순서를 바꾸면 본부 전체에 같은 순서로 저장 */}
        <div className="flex flex-wrap gap-2">
          {tabs.map(p => {
            const on = purpose === p.key;
            return (
              <button key={p.key} type="button" draggable onClick={() => setPurpose(p.key)} aria-pressed={on} title={`${p.hint} · 끌어서 순서 변경`}
                onDragStart={(e) => { drag.current = { kind: "tab", key: p.key }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "x"); }}
                onDragOver={(e) => { if (drag.current?.kind === "tab") { e.preventDefault(); setDropKey(`tab:${p.key}`); } }}
                onDragLeave={() => setDropKey(null)} onDrop={(e) => { e.preventDefault(); onTabDrop(p.key); }}
                className={cn("inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  on ? "bg-indigo-600 text-white border-indigo-600" : "bg-white text-gray-700 border-gray-200 hover:border-indigo-300",
                  dropKey === `tab:${p.key}` && "ring-2 ring-indigo-200")}>
                <span className={cn("h-1.5 w-1.5 rounded-full", on ? "bg-white" : PURPOSE_DOT[p.key])} />
                {p.label}<span className={cn("text-xs", on ? "text-indigo-100" : "text-gray-400")}>{loading ? "" : listFor(p.key).length}</span>
              </button>
            );
          })}
        </div>
        {loading ? (
          <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">서류를 불러오는 중…</p>
        ) : list.length === 0 && purpose !== "hire" && purpose !== "resign" ? (
          <p className="rounded-xl border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
            이 용도의 서류가 없습니다. <Link href="/admin/contract-templates" className="text-indigo-600 underline">양식 관리</Link>에서 서류의 용도를 정할 수 있습니다.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {/* 즐겨찾기에 올라간 묶음은 위에 이미 있어 여기서는 뺀다(같은 카드 두 번 — 2026-10-28 이예지 디자인 ⑩) */}
            {purpose === "hire" && !isFav({ t: "hire", id: "hire" }) && pkgCard("hire")}
            {purpose === "resign" && !isFav({ t: "resign", id: "resign" }) && pkgCard("resign")}
            {list.map(tplCard)}
          </div>
        )}
      </section>

      {/* 고른 서류 띠 — 한 장이면 바로 보내기, 여러 장이면 묶음으로 저장·보내기 */}
      {checked.length > 0 && (
        <div className="fixed inset-x-0 md:left-[284px] bottom-0 z-30 px-4 pb-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto max-w-5xl rounded-xl border border-indigo-300 bg-white shadow-lg px-4 py-3 flex flex-wrap items-center gap-3">
            <p className="font-bold text-gray-900">고른 서류 {checked.length}건</p>
            <p className="flex-1 min-w-0 truncate text-xs text-gray-500">{checked.map(id => tplOf(id)?.name).filter(Boolean).map(n => displayTplName(n as string)).join(" · ")}</p>
            <button type="button" onClick={() => setChecked([])} className="text-xs text-gray-400 hover:text-gray-600">선택 해제</button>
            {checked.length >= 2 && <button type="button" onClick={() => saveBundle(checked, "새 묶음")} className="rounded-lg border border-indigo-200 px-4 py-2 text-sm font-semibold text-indigo-700 hover:bg-indigo-50">묶음으로 저장</button>}
            <button type="button" onClick={sendChecked} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-bold text-white hover:bg-indigo-700">보내기</button>
          </div>
        </div>
      )}
    </div>
  );
}
