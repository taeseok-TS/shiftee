"use client";

// PDF 양식 칸 배치 편집기(2026-10-13 QA76 #22 2단계 「끌어다 놓는 편집기」, 희망화면 6)
//  · 왼쪽: 칸 추가(텍스트·날짜·체크박스·드롭다운·이미지·서명·직인), 자동 입력 칸, 서명자 역할 색
//  · 가운데: PDF 쪽(PDF.js 캔버스) 위에 칸 상자. 끌어서 이동, 오른쪽 아래 손잡이로 크기, 방향키로 미세 이동, Delete 로 삭제
//  · 오른쪽: 선택한 칸의 이름·담당·채우는 방식·필수·글자 크기·정렬·선택지, 수정 기록
// 좌표는 쪽 비율(0~1)로 저장하므로 화면 배율과 무관하다. 저장은 PATCH /api/contract-templates/[id] { layout }.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { acquirePdfRafFallback } from "@/lib/pdf-raf-fallback";
import { AUTO_SOURCES, FIELD_MODES, type FieldMode } from "@/lib/contract-field-settings";
import { LAYOUT_ROLES, LAYOUT_TYPES, SIGN_MARKER_NAME, type LayoutField, type LayoutFieldType, type LayoutRole, type TemplateLayout } from "@/lib/contract-layout-core";
import { CheckSquare, ChevronDown, Image as ImageIcon, PenLine, Stamp, Type, Calendar, Trash2, Copy, Undo2, Save, ZoomIn, ZoomOut, Eye } from "lucide-react";

type Props = { templateId: string; fileUrl: string; name: string; initial: TemplateLayout | null };
type PageInfo = { w: number; h: number };   // PDF 포인트 단위 쪽 크기
type Drag = { id: string; kind: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; pw: number; ph: number; ids: string[]; orig: Record<string, { x: number; y: number }> };
type Guides = { page: number; xs: number[]; ys: number[] };
const SNAP = 0.004;   // 정렬 보조선에 달라붙는 거리(쪽 비율, A4 760px 기준 약 3px)
type HistoryItem = { id: string; at: string; by: string; detail: string };
// pdfjs-dist 중 쓰는 부분만(패키지 타입은 any 투성이라 여기서 좁힌다)
type RenderTask = { promise: Promise<void>; cancel: () => void };
type PdfPage = { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => RenderTask };
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy?: () => void };
type PdfJs = { GlobalWorkerOptions: { workerSrc: string }; getDocument: (o: Record<string, unknown>) => { promise: Promise<PdfDoc> } };
const fetchHistory = async (templateId: string): Promise<HistoryItem[] | null> => {
  const r = await fetch(`/api/contract-templates/${templateId}/history`).catch(() => null);
  const d = r && r.ok ? await r.json().catch(() => null) : null;
  return Array.isArray(d?.items) ? d.items : null;
};

const TYPE_ICON: Record<LayoutFieldType, React.ReactNode> = {
  text: <Type size={14} />, date: <Calendar size={14} />, checkbox: <CheckSquare size={14} />, select: <ChevronDown size={14} />,
  image: <ImageIcon size={14} />, signature: <PenLine size={14} />, seal: <Stamp size={14} />,
};
const DEFAULT_SIZE: Record<LayoutFieldType, { w: number; h: number }> = {
  text: { w: 0.22, h: 0.025 }, date: { w: 0.18, h: 0.025 }, checkbox: { w: 0.02, h: 0.015 }, select: { w: 0.18, h: 0.025 },
  image: { w: 0.15, h: 0.1 }, signature: { w: 0.16, h: 0.05 }, seal: { w: 0.06, h: 0.045 },
};
// 담당(누가 채우나) — 희망화면의 「작성자」. 채우는 방식(mode)으로 저장한다
const OWNERS: { value: FieldMode; label: string; hint: string }[] = [
  { value: "hq", label: "직영사업본부 (보낼 때 입력)", hint: FIELD_MODES.find((m) => m.value === "hq")!.hint },
  { value: "sign", label: "직원 (서명할 때 입력)", hint: FIELD_MODES.find((m) => m.value === "sign")!.hint },
  { value: "auto", label: "자동 입력 (인사카드 값 그대로)", hint: FIELD_MODES.find((m) => m.value === "auto")!.hint },
  { value: "edit", label: "자동 입력 후 보내기 전 수정", hint: FIELD_MODES.find((m) => m.value === "edit")!.hint },
];
const roleColor = (f: LayoutField) => {
  const role = f.type === "seal" ? "HQ" : f.type === "signature" ? f.role : f.mode === "sign" ? "EMPLOYEE" : f.mode === "auto" ? "AUTO" : "HQ";
  if (role === "EMPLOYEE") return { border: "border-blue-500", bg: "bg-blue-500/15", text: "text-blue-700", chip: "bg-blue-100 text-blue-700" };
  if (role === "MANAGER") return { border: "border-green-600", bg: "bg-green-500/15", text: "text-green-700", chip: "bg-green-100 text-green-700" };
  if (role === "AUTO") return { border: "border-gray-500", bg: "bg-gray-400/15", text: "text-gray-700", chip: "bg-gray-100 text-gray-700" };
  return { border: "border-amber-500", bg: "bg-amber-400/20", text: "text-amber-800", chip: "bg-amber-100 text-amber-800" };
};
const newId = () => `f_${Math.random().toString(36).slice(2, 10)}`;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const fmtAt = (s: string) => { const d = new Date(s); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export default function LayoutEditor({ templateId, fileUrl, name, initial }: Props) {
  const [fields, setFields] = useState<LayoutField[]>(initial?.fields ?? []);
  const [selected, setSelected] = useState<string | null>(null);   // 주 선택(속성 패널·크기 조절 대상)
  const [extra, setExtra] = useState<string[]>([]);                 // Shift+클릭으로 더한 선택 — 함께 옮기고 지운다
  const [guides, setGuides] = useState<Guides | null>(null);        // 끌 때 다른 칸·쪽 가장자리에 맞으면 보이는 정렬 보조선
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [pdfError, setPdfError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [activePage, setActivePage] = useState(1);
  const undoRef = useRef<LayoutField[][]>([]);
  const [undoCount, setUndoCount] = useState(0);   // 되돌리기 버튼 활성 여부(렌더 중 ref 를 읽지 않게 상태로)
  const docRef = useRef<PdfDoc | null>(null);
  const renderTasks = useRef<Map<number, RenderTask>>(new Map());
  const fieldsRef = useRef(fields);   // 되돌리기 스택은 업데이터 밖에서 현재 값으로 쌓는다(StrictMode 이중 호출에 두 번 쌓이지 않게, 10/13 검증 10)
  useEffect(() => { fieldsRef.current = fields; }, [fields]);   // 끌기(setFields 직접 갱신) 뒤에도 최신 값이 되게
  const canvasRefs = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const dragRef = useRef<Drag | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const baseWidth = 760;   // 쪽 기본 너비(px). 배율은 이 값에 곱한다

  const sel = useMemo(() => fields.find((f) => f.id === selected) ?? null, [fields, selected]);
  const selIds = useMemo(() => (selected ? [selected, ...extra.filter((id) => id !== selected)] : []), [selected, extra]);
  const clearSel = useCallback(() => { setSelected(null); setExtra([]); }, []);

  // ── 되돌리기 스택을 쌓고 바꾼다
  const commit = useCallback((next: LayoutField[] | ((prev: LayoutField[]) => LayoutField[])) => {
    const cur = fieldsRef.current;
    undoRef.current = [...undoRef.current.slice(-49), cur];
    const out = typeof next === "function" ? next(cur) : next;
    fieldsRef.current = out;
    setFields(out);
    setUndoCount(undoRef.current.length);
    setDirty(true);
  }, []);
  const undo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) return;
    fieldsRef.current = prev;
    setFields(prev); setDirty(true); setUndoCount(undoRef.current.length);
    setSelected(null); setExtra([]);   // 되돌린 뒤엔 없는 칸을 가리킬 수 있어 선택을 푼다
  }, []);
  const patchField = useCallback((id: string, patch: Partial<LayoutField>) => {
    commit((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  }, [commit]);
  // 선택한 칸(여러 개면 전부)을 살짝 비켜 복제하고 복제본을 선택한다
  const duplicate = useCallback((ids: string[]) => {
    const copies = ids.map((id) => fields.find((x) => x.id === id)).filter((f): f is LayoutField => !!f)
      .map((f) => ({ ...f, id: newId(), x: clamp(f.x + 0.02, 0, 1 - f.w), y: clamp(f.y + 0.02, 0, 1 - f.h) }));
    if (!copies.length) return;
    commit((p) => [...p, ...copies]); setSelected(copies[0].id); setExtra(copies.slice(1).map((c) => c.id));
  }, [fields, commit]);
  const removeIds = useCallback((ids: string[]) => {
    if (!ids.length) return;
    const set = new Set(ids);
    commit((p) => p.filter((f) => !set.has(f.id))); setSelected(null); setExtra([]);
  }, [commit]);

  // ── 수정 기록
  useEffect(() => {
    let alive = true;
    fetchHistory(templateId).then((items) => { if (alive && items) setHistory(items); });
    return () => { alive = false; };
  }, [templateId]);

  // ── PDF 열기·쪽 그리기(PdfViewer 와 같은 방식)
  useEffect(() => acquirePdfRafFallback(), []);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const pdfjs = (await import("pdfjs-dist")) as unknown as PdfJs;
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf = await pdfjs.getDocument({ url: fileUrl, withCredentials: true, cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/" }).promise;
        if (!alive) return;
        docRef.current = pdf;
        const infos: PageInfo[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const p = await pdf.getPage(i);
          const vp = p.getViewport({ scale: 1 });
          infos.push({ w: vp.width, h: vp.height });
        }
        if (alive) setPages(infos);
      } catch (e) {
        console.error("PDF 열기 실패:", e);
        if (alive) setPdfError("PDF 를 열지 못했습니다. 파일이 PDF 인지 확인해 주세요.");
      }
    })();
    return () => { alive = false; try { docRef.current?.destroy?.(); } catch { /* 무시 */ } docRef.current = null; };
  }, [fileUrl]);
  // 쪽 캔버스 렌더 — 배율이 바뀔 때마다 다시 그린다(벡터라 선명).
  // 진행 중인 render 는 취소하고 끝나기를 기다린 뒤 새로 건다 — 같은 캔버스에 겹쳐 걸면 pdfjs 가 거부하고
  // 옛 배율 그림이 새 크기 캔버스에 남는다(10/13 검증 5)
  useEffect(() => {
    const pdf = docRef.current;
    if (!pdf || !pages.length) return;
    let cancelled = false;
    (async () => {
      for (let i = 1; i <= pages.length; i++) {
        if (cancelled) return;
        const canvas = canvasRefs.current.get(i);
        if (!canvas) continue;
        const prev = renderTasks.current.get(i);
        if (prev) { try { prev.cancel(); } catch { /* 무시 */ } try { await prev.promise; } catch { /* 취소 예외는 정상 */ } }
        if (cancelled) return;
        const page = await pdf.getPage(i);
        if (cancelled) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const scale = (baseWidth * zoom) / pages[i - 1].w;
        const vp = page.getViewport({ scale: scale * dpr });
        canvas.width = vp.width; canvas.height = vp.height;
        canvas.style.width = `${vp.width / dpr}px`; canvas.style.height = `${vp.height / dpr}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        const task = page.render({ canvasContext: ctx, viewport: vp });
        renderTasks.current.set(i, task);
        try { await task.promise; } catch { /* 취소 */ }
        finally { if (renderTasks.current.get(i) === task) renderTasks.current.delete(i); }
      }
    })().catch(() => { /* 언마운트로 문서가 닫힌 뒤의 getPage 거부 — 소음만 */ });
    return () => { cancelled = true; for (const t of renderTasks.current.values()) { try { t.cancel(); } catch { /* 무시 */ } } };
  }, [pages, zoom]);

  // ── 떠나기 전 경고
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  // ── 키보드: Delete 삭제, 방향키 이동, Ctrl+Z 되돌리기, Ctrl+D 복제
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {   // 보고 있는 쪽의 칸 전부 선택
        e.preventDefault();
        const ids = fieldsRef.current.filter((f) => f.page === activePage).map((f) => f.id);
        if (ids.length) { setSelected(ids[0]); setExtra(ids.slice(1)); }
        return;
      }
      if (!selIds.length) return;
      if (e.key === "Escape") { clearSel(); return; }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); removeIds(selIds); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") { e.preventDefault(); duplicate(selIds); return; }
      const step = e.shiftKey ? 0.01 : 0.002;
      const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (d[e.key]) {
        e.preventDefault();
        const [dx, dy] = d[e.key];
        const set = new Set(selIds);
        commit((p) => p.map((f) => (set.has(f.id) ? { ...f, x: clamp(f.x + dx, 0, 1 - f.w), y: clamp(f.y + dy, 0, 1 - f.h) } : f)));
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selIds, activePage, commit, undo, duplicate, removeIds, clearSel]);

  // ── 칸 추가
  const addField = (type: LayoutFieldType, at?: { page: number; x: number; y: number }, preset?: Partial<LayoutField>) => {
    const page = at?.page ?? activePage;
    const size = DEFAULT_SIZE[type];
    const f: LayoutField = {
      id: newId(),
      name: type === "signature" ? SIGN_MARKER_NAME[preset?.role ?? "EMPLOYEE"] : type === "seal" ? SIGN_MARKER_NAME.seal : preset?.name ?? `${LAYOUT_TYPES.find((t) => t.value === type)?.label}${fields.length + 1}`,
      type, page,
      x: clamp((at?.x ?? 0.1) - size.w / 2, 0, 1 - size.w), y: clamp((at?.y ?? 0.1) - size.h / 2, 0, 1 - size.h), w: size.w, h: size.h,
      ...(type === "signature" ? { role: preset?.role ?? "EMPLOYEE" } : type === "seal" ? {} : { mode: preset?.mode ?? "hq", fontSize: 10 }),
      ...(preset?.source ? { source: preset.source } : {}),
    };
    commit((p) => [...p, f]);
    setSelected(f.id); setExtra([]);
  };
  // ── 끌기(이동·크기)
  const onPointerDown = (e: React.PointerEvent, f: LayoutField, kind: "move" | "resize") => {
    e.stopPropagation(); e.preventDefault();
    const pageEl = pageRefs.current.get(f.page);
    if (!pageEl) return;
    const r = pageEl.getBoundingClientRect();
    // 선택: Shift+클릭은 더하기/빼기, 이미 선택된 칸을 누르면 선택을 유지한 채 함께 끈다, 아니면 그 칸만
    let ids: string[];
    if (kind === "resize") ids = [f.id];
    else if (e.shiftKey) {
      if (selIds.includes(f.id)) { ids = selIds.filter((id) => id !== f.id); setSelected(ids[0] ?? null); setExtra(ids.slice(1)); dragRef.current = null; return; }
      ids = [...selIds, f.id]; setSelected(f.id); setExtra(selIds);
    } else if (selIds.includes(f.id)) { ids = selIds; setSelected(f.id); setExtra(selIds.filter((id) => id !== f.id)); }
    else { ids = [f.id]; setSelected(f.id); setExtra([]); }
    const orig: Record<string, { x: number; y: number }> = {};
    for (const g of fields) if (ids.includes(g.id)) orig[g.id] = { x: g.x, y: g.y };
    dragRef.current = { id: f.id, kind, sx: e.clientX, sy: e.clientY, ox: f.x, oy: f.y, ow: f.w, oh: f.h, pw: r.width, ph: r.height, ids, orig };
    undoRef.current = [...undoRef.current.slice(-49), fields];
    setUndoCount(undoRef.current.length);
    setActivePage(f.page);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    let dx = (e.clientX - d.sx) / d.pw, dy = (e.clientY - d.sy) / d.ph;
    if (d.kind === "resize") {
      setFields((prev) => prev.map((f) => (f.id === d.id ? { ...f, w: clamp(d.ow + dx, 0.005, 1 - f.x), h: clamp(d.oh + dy, 0.005, 1 - f.y) } : f)));
      return;
    }
    // 정렬 보조선 — 끄는 칸(주 선택)의 왼쪽·가운데·오른쪽(위·가운데·아래)이 같은 쪽 다른 칸의 선이나 쪽 가장자리·중앙에 가까우면 달라붙는다
    const me = fieldsRef.current.find((f) => f.id === d.id);
    if (me) {
      const others = fieldsRef.current.filter((f) => f.page === me.page && !d.ids.includes(f.id));
      const xs = [0, 0.5, 1, ...others.flatMap((g) => [g.x, g.x + g.w / 2, g.x + g.w])];
      const ys = [0, 0.5, 1, ...others.flatMap((g) => [g.y, g.y + g.h / 2, g.y + g.h])];
      const nx = clamp(d.ox + dx, 0, 1 - me.w), ny = clamp(d.oy + dy, 0, 1 - me.h);
      const snap = (cands: number[], edges: number[]) => {
        let best: { diff: number; line: number } | null = null;
        for (const c of cands) for (const edge of edges) { const diff = c - edge; if (Math.abs(diff) <= SNAP && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, line: c }; }
        return best;
      };
      const sx = snap(xs, [nx, nx + me.w / 2, nx + me.w]), sy = snap(ys, [ny, ny + me.h / 2, ny + me.h]);
      const okX = sx && clamp(nx + sx.diff, 0, 1 - me.w) === nx + sx.diff;
      const okY = sy && clamp(ny + sy.diff, 0, 1 - me.h) === ny + sy.diff;
      if (okX && sx) dx += sx.diff;
      if (okY && sy) dy += sy.diff;
      setGuides(okX || okY ? { page: me.page, xs: okX && sx ? [sx.line] : [], ys: okY && sy ? [sy.line] : [] } : null);
    }
    setFields((prev) => prev.map((f) => {
      const o = d.orig[f.id];
      if (!o) return f;
      return { ...f, x: clamp(o.x + dx, 0, 1 - f.w), y: clamp(o.y + dy, 0, 1 - f.h) };
    }));
  };
  const onPointerUp = () => { if (dragRef.current) { dragRef.current = null; setDirty(true); } setGuides(null); };

  // ── 팔레트에서 쪽으로 끌어다 놓기(HTML5 DnD)
  const onDrop = (e: React.DragEvent, pageNo: number) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/x-layout-field");
    if (!raw) return;
    const { type, preset } = JSON.parse(raw) as { type: LayoutFieldType; preset?: Partial<LayoutField> };
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    addField(type, { page: pageNo, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }, preset);
  };
  const dragStart = (e: React.DragEvent, type: LayoutFieldType, preset?: Partial<LayoutField>) => {
    e.dataTransfer.setData("text/x-layout-field", JSON.stringify({ type, preset }));
    e.dataTransfer.effectAllowed = "copy";
  };

  // ── 저장
  const save = async () => {
    const bad = fields.filter((f) => f.type !== "signature" && f.type !== "seal" && !f.name.trim());
    if (bad.length) { toast.error("이름이 없는 칸이 있습니다."); setSelected(bad[0].id); setExtra([]); return; }
    setSaving(true);
    try {
      const res = await fetch(`/api/contract-templates/${templateId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ layout: fields.length ? { v: 1, fields } : null }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "저장하지 못했습니다."); return; }
      setDirty(false);
      toast.success("칸 배치를 저장했습니다.");
      fetchHistory(templateId).then((items) => { if (items) setHistory(items); });
    } finally { setSaving(false); }
  };
  // ── 시험 미리보기 — 시험 값으로 채운 PDF 를 새 탭에(값은 노란 바탕, 빈 칸은 붉은 표시). 저장된 배치 기준이라 먼저 저장해야 한다
  const preview = async () => {
    if (dirty) { toast.error("먼저 저장한 뒤 미리보기를 열어 주세요."); return; }
    const res = await fetch("/api/contracts/preview", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ templateId, externalName: "홍길동(시험)", externalPhone: "010-0000-0000", title: `${name} (시험)`, highlight: true, startDate: new Date().toISOString().slice(0, 10) }) });
    if (!res.ok) { const d = await res.json().catch(() => ({})); toast.error(d.error || "미리보기를 만들지 못했습니다."); return; }
    const url = URL.createObjectURL(await res.blob());
    window.open(url, "_blank");
  };

  const countByRole = useMemo(() => ({
    EMPLOYEE: fields.filter((f) => (f.type === "signature" && f.role === "EMPLOYEE") || (f.type !== "signature" && f.type !== "seal" && f.mode === "sign")).length,
    MANAGER: fields.filter((f) => f.type === "signature" && f.role === "MANAGER").length,
    HQ: fields.filter((f) => f.type === "seal" ? true : f.type === "signature" ? f.role === "HQ" : (f.mode === "hq" || f.mode === "edit" || !f.mode)).length,
  }), [fields]);

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] min-h-[560px]">
      {/* 상단 바 */}
      <div className="flex items-center gap-2 pb-2 border-b flex-wrap">
        <h1 className="text-lg font-semibold truncate">{name} <span className="text-sm text-gray-500 font-normal">— 칸 배치 편집기</span></h1>
        <span className="text-xs text-gray-500">칸 {fields.length}개{dirty ? " · 저장 안 됨" : ""}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))} title="축소"><ZoomOut size={14} /></Button>
          <span className="text-xs w-10 text-center">{Math.round(zoom * 100)}%</span>
          <Button size="sm" variant="outline" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)))} title="확대"><ZoomIn size={14} /></Button>
          <Button size="sm" variant="outline" onClick={undo} disabled={!undoCount} className="gap-1"><Undo2 size={14} />되돌리기</Button>
          <Button size="sm" variant="outline" onClick={preview} className="gap-1" title="시험 값으로 채운 PDF 를 새 탭에 엽니다"><Eye size={14} />시험 미리보기</Button>
          <Button size="sm" onClick={save} disabled={saving || !dirty} className="gap-1"><Save size={14} />{saving ? "저장 중…" : "저장"}</Button>
        </div>
      </div>

      <div className="flex flex-1 min-h-0 gap-3 pt-3">
        {/* 왼쪽: 팔레트 */}
        <aside className="w-52 shrink-0 overflow-auto space-y-4 text-sm">
          <section>
            <h2 className="font-semibold mb-1.5">입력칸 추가</h2>
            <p className="text-[11px] text-gray-500 mb-1.5">누르면 {activePage}쪽에 놓이고, 끌어서 원하는 자리에 놓을 수도 있습니다.</p>
            <div className="space-y-1">
              {LAYOUT_TYPES.map((t) => (
                <button key={t.value} type="button" draggable onDragStart={(e) => dragStart(e, t.value)} onClick={() => addField(t.value)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded border bg-white hover:bg-gray-50 text-left cursor-grab active:cursor-grabbing">
                  {TYPE_ICON[t.value]}{t.label}
                  {t.value === "signature" && <span className="ml-auto text-[10px] text-gray-400">직원·원장·본부</span>}
                  {t.value === "seal" && <span className="ml-auto text-[10px] text-gray-400">회사 직인</span>}
                </button>
              ))}
            </div>
          </section>
          <section>
            <h2 className="font-semibold mb-1.5">자동 입력칸</h2>
            <p className="text-[11px] text-gray-500 mb-1.5">직원 정보·날짜로 시스템이 채웁니다.</p>
            <div className="flex flex-wrap gap-1">
              {AUTO_SOURCES.map((s) => (
                <button key={s.key} type="button" draggable onDragStart={(e) => dragStart(e, "text", { name: s.key, mode: "auto" })} onClick={() => addField("text", undefined, { name: s.key, mode: "auto" })}
                  className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 text-xs hover:bg-blue-100 cursor-grab" title={s.label}>{`{${s.key}}`}</button>
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">다른 값을 자동으로 넣으려면 텍스트 칸을 놓고 담당을 「자동 입력」으로 바꾼 뒤 출처나 고정 문구를 고릅니다.</p>
          </section>
          <section>
            <h2 className="font-semibold mb-1.5">서명자 역할</h2>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-blue-500" />직원 <span className="text-gray-400">{countByRole.EMPLOYEE}칸</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-green-600" />지점 원장 <span className="text-gray-400">{countByRole.MANAGER}칸</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-amber-500" />직영사업본부 <span className="text-gray-400">{countByRole.HQ}칸</span></div>
              <div className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full bg-gray-500" />자동 입력</div>
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">서명 순서(본부→원장→직원 등)는 템플릿 수정 창의 「결재 순서」에서 정합니다.</p>
            <p className="text-[11px] text-gray-500 mt-1.5">저장한 배치는 그 뒤에 만들거나 다시 그리는 계약서부터 적용됩니다. 이미 만든 문서는 그 문서를 마지막으로 그렸을 때의 배치대로 서명이 찍힙니다.</p>
          </section>
        </aside>

        {/* 가운데: PDF 쪽 + 칸 */}
        <div ref={wrapRef} className="flex-1 min-w-0 overflow-auto bg-gray-200 rounded-lg p-4" onPointerDown={clearSel}>
          {pdfError && <p className="text-red-600 text-sm">{pdfError}</p>}
          {!pdfError && !pages.length && <p className="text-gray-500 text-sm">PDF 를 여는 중…</p>}
          <div className="flex flex-col items-center gap-4">
            {pages.map((p, i) => {
              const no = i + 1;
              const w = baseWidth * zoom, h = (baseWidth * zoom * p.h) / p.w;
              return (
                <div key={no} className="relative">
                  <div className="absolute -left-10 top-0 text-xs text-gray-500 select-none">{no}쪽</div>
                  <div ref={(el) => { if (el) pageRefs.current.set(no, el); }} className={`relative bg-white shadow ${activePage === no ? "ring-2 ring-blue-300" : ""}`} style={{ width: w, height: h }}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }} onDrop={(e) => onDrop(e, no)}
                    onPointerDown={() => setActivePage(no)} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
                    <canvas ref={(el) => { if (el) canvasRefs.current.set(no, el); }} className="absolute inset-0 pointer-events-none" />
                    {guides?.page === no && guides.xs.map((x) => <div key={`gx${x}`} className="absolute top-0 bottom-0 w-px bg-pink-500 pointer-events-none z-20" style={{ left: `${x * 100}%` }} />)}
                    {guides?.page === no && guides.ys.map((y) => <div key={`gy${y}`} className="absolute left-0 right-0 h-px bg-pink-500 pointer-events-none z-20" style={{ top: `${y * 100}%` }} />)}
                    {fields.filter((f) => f.page === no).map((f) => {
                      const c = roleColor(f);
                      const isSel = f.id === selected || extra.includes(f.id);
                      return (
                        <div key={f.id} role="button" tabIndex={0} aria-label={`${f.name} 칸`}
                          onPointerDown={(e) => onPointerDown(e, f, "move")} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
                          className={`absolute border-2 border-dashed rounded-sm cursor-move select-none ${c.border} ${c.bg} ${isSel ? "ring-2 ring-offset-1 ring-blue-500 z-10" : ""}`}
                          style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}>
                          <span className={`absolute left-0 -top-4 text-[10px] leading-4 px-1 rounded whitespace-nowrap ${c.chip} ${isSel ? "" : "opacity-90"}`}>
                            {f.type === "signature" ? `${LAYOUT_ROLES.find((r) => r.value === f.role)?.label} 서명` : f.type === "seal" ? "회사 직인" : `{${f.name}}`}{f.required ? " · 필수" : ""}
                          </span>
                          {f.id === selected && (
                            <span onPointerDown={(e) => onPointerDown(e, f, "resize")} className="absolute -right-1.5 -bottom-1.5 w-3 h-3 bg-blue-600 rounded-sm cursor-nwse-resize" aria-label="크기 조절" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 오른쪽: 속성·수정 기록 */}
        <aside className="w-72 shrink-0 overflow-auto space-y-4 text-sm">
          <section className="border rounded-lg p-3 bg-white space-y-2">
            {extra.length > 0 ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">{selIds.length}개 칸 선택</h2>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => duplicate(selIds)} className="p-1 rounded hover:bg-gray-100" title="모두 복제"><Copy size={14} /></button>
                    <button type="button" onClick={() => removeIds(selIds)} className="p-1 rounded hover:bg-red-50 text-red-600" title="모두 삭제"><Trash2 size={14} /></button>
                  </div>
                </div>
                <p className="text-xs text-gray-500">끌거나 방향키로 함께 옮깁니다. Shift+클릭으로 선택을 더하거나 빼고, Esc 로 풉니다. 이름·담당은 칸 하나만 선택했을 때 바꿀 수 있습니다.</p>
              </div>
            ) : !sel ? (
              <p className="text-xs text-gray-500">칸을 누르면 여기서 이름·담당·필수를 정합니다. Delete 로 삭제, 방향키로 미세 이동(Shift 로 크게), Ctrl+Z 되돌리기, Ctrl+D 복제, Shift+클릭으로 여러 칸 선택, Ctrl+A 로 이 쪽 전부 선택. 끌 때 다른 칸과 줄이 맞으면 분홍 보조선이 뜹니다.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="font-semibold">선택한 칸{sel.type !== "signature" && sel.type !== "seal" ? `: {${sel.name}}` : ""}</h2>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => duplicate([sel.id])} className="p-1 rounded hover:bg-gray-100" title="복제"><Copy size={14} /></button>
                    <button type="button" onClick={() => removeIds([sel.id])} className="p-1 rounded hover:bg-red-50 text-red-600" title="삭제"><Trash2 size={14} /></button>
                  </div>
                </div>
                <label className="block text-xs text-gray-600">종류
                  <select value={sel.type} className="mt-1 h-8 w-full rounded border px-2 bg-white" onChange={(e) => {
                    const type = e.target.value as LayoutFieldType;
                    const patch: Partial<LayoutField> = { type };
                    if (type === "signature") { patch.role = sel.role ?? "EMPLOYEE"; patch.name = SIGN_MARKER_NAME[patch.role]; patch.mode = undefined; patch.required = undefined; }
                    else if (type === "seal") { patch.name = SIGN_MARKER_NAME.seal; patch.role = undefined; patch.mode = undefined; patch.required = undefined; }
                    else if (sel.type === "signature" || sel.type === "seal") { patch.name = `${LAYOUT_TYPES.find((t) => t.value === type)?.label}${fields.length}`; patch.mode = "hq"; patch.role = undefined; }
                    patchField(sel.id, patch);
                  }}>
                    {LAYOUT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </label>
                {sel.type === "signature" && (
                  <label className="block text-xs text-gray-600">누가 서명하나
                    <select value={sel.role ?? "EMPLOYEE"} className="mt-1 h-8 w-full rounded border px-2 bg-white" onChange={(e) => { const role = e.target.value as LayoutRole; patchField(sel.id, { role, name: SIGN_MARKER_NAME[role] }); }}>
                      {LAYOUT_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                    </select>
                    <span className="block text-[11px] text-gray-400 mt-1">본부 서명 자리에는 회사 직인이 찍힙니다(2026-08-25 확정).</span>
                  </label>
                )}
                {sel.type === "seal" && <p className="text-[11px] text-gray-500">최종 결재가 끝나면 회사 직인이 이 자리에 찍힙니다.</p>}
                {sel.type !== "signature" && sel.type !== "seal" && (
                  <>
                    <label className="block text-xs text-gray-600">칸 이름
                      <NameInput key={sel.id} value={sel.name} onCommit={(name) => patchField(sel.id, { name })} />
                      <span className="block text-[11px] text-gray-400 mt-1">같은 이름의 칸이 여러 개면 같은 값이 모두 찍힙니다. 직원명·지점·입사일 같은 이름은 자동으로 채워집니다.</span>
                    </label>
                    <label className="block text-xs text-gray-600">작성자(누가 채우나)
                      <select value={sel.mode ?? "hq"} className="mt-1 h-8 w-full rounded border px-2 bg-white" onChange={(e) => {
                        const mode = e.target.value as FieldMode;
                        patchField(sel.id, { mode, ...(mode === "auto" ? { required: undefined } : { source: undefined, text: undefined }) });
                      }}>
                        {OWNERS.map((o) => <option key={o.value} value={o.value} title={o.hint}>{o.label}</option>)}
                      </select>
                    </label>
                    {sel.mode === "auto" && (
                      <div className="text-xs text-gray-600 space-y-1">
                        <span>자동 값</span>
                        <select value={sel.source ?? ""} className="h-8 w-full rounded border px-2 bg-white" onChange={(e) => patchField(sel.id, { source: e.target.value || undefined, text: e.target.value ? undefined : sel.text })}>
                          <option value="">{AUTO_SOURCES.some((s) => s.key === sel.name) ? "(이름과 같은 시스템 값)" : "(출처 고르기)"}</option>
                          {AUTO_SOURCES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
                        </select>
                        {!sel.source && <input value={sel.text ?? ""} maxLength={200} placeholder="또는 고정 문구" className="h-8 w-full rounded border px-2 bg-white" onChange={(e) => patchField(sel.id, { text: e.target.value || undefined })} />}
                      </div>
                    )}
                    {sel.mode !== "auto" && (
                      <label className="flex items-center gap-2 text-xs text-gray-700">
                        <input type="checkbox" checked={!!sel.required} onChange={(e) => patchField(sel.id, { required: e.target.checked || undefined })} />필수 칸(비면 보내기·서명을 막습니다)
                      </label>
                    )}
                    {sel.type === "select" && (
                      <label className="block text-xs text-gray-600">선택지(한 줄에 하나)
                        <textarea value={(sel.options ?? []).join("\n")} rows={3} className="mt-1 w-full rounded border px-2 py-1 bg-white" onChange={(e) => patchField(sel.id, { options: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 30) })} />
                      </label>
                    )}
                    {sel.type !== "checkbox" && sel.type !== "image" && (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs text-gray-600">글자 크기(pt)
                          <input type="number" min={6} max={24} value={sel.fontSize ?? 10} className="mt-1 h-8 w-full rounded border px-2 bg-white" onChange={(e) => patchField(sel.id, { fontSize: clamp(Number(e.target.value) || 10, 6, 24) })} />
                        </label>
                        <label className="block text-xs text-gray-600">정렬
                          <select value={sel.align ?? "left"} className="mt-1 h-8 w-full rounded border px-2 bg-white" onChange={(e) => patchField(sel.id, { align: e.target.value === "left" ? undefined : (e.target.value as "center" | "right") })}>
                            <option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option>
                          </select>
                        </label>
                      </div>
                    )}
                  </>
                )}
                <div className="grid grid-cols-4 gap-1 text-[11px] text-gray-500 pt-1 border-t">
                  <span>{sel.page}쪽</span><span>x {(sel.x * 100).toFixed(1)}%</span><span>y {(sel.y * 100).toFixed(1)}%</span><span>{(sel.w * 100).toFixed(1)}×{(sel.h * 100).toFixed(1)}</span>
                </div>
              </>
            )}
          </section>
          <section className="border rounded-lg p-3 bg-white">
            <h2 className="font-semibold mb-1.5">수정 기록</h2>
            {history.length === 0 ? <p className="text-xs text-gray-400">아직 기록이 없습니다.</p> : (
              <ul className="space-y-1.5 max-h-72 overflow-auto">
                {history.map((h) => (
                  <li key={h.id} className="text-[11px] leading-snug">
                    <span className="text-gray-500">{fmtAt(h.at)} {h.by}</span>
                    <span className="block text-gray-700 break-words">· {h.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

// 칸 이름 — 글자마다 되돌리기 스택을 쌓지 않게 포커스를 잃을 때(또는 Enter) 한 번만 반영한다
function NameInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <input value={v} maxLength={30} className="mt-1 h-8 w-full rounded border px-2 bg-white"
      onChange={(e) => setV(e.target.value.replace(/[{}]/g, ""))}
      onBlur={() => { const t = v.trim(); if (t && t !== value) onCommit(t); else if (!t) setV(value); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  );
}
