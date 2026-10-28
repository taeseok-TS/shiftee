"use client";

// 계약서를 A4 한 쪽씩 보여 주는 뷰어(2026-10-20 본부 박정인 시안 v2 6번 — 원장 승인·미리보기 전체 창).
// 「◀ 이전 쪽 · 1 / 6쪽 · 다음 쪽 ▶」, 키보드 ← →, 왼쪽 쪽 목록, 축소·확대. 줄어든 미리보기·이어 붙인 긴 화면 대신 쪽 맞춤.
// 렌더 방식(PDF.js·CID 글꼴·숨은 탭 rAF 보완)은 components/PdfViewer 와 같다.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Download, Check, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { acquirePdfRafFallback } from "@/lib/pdf-raf-fallback";

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy?: () => void };
type PdfPage = { getViewport: (o: { scale: number }) => { width: number; height: number }; render: (o: unknown) => { promise: Promise<void>; cancel: () => void } };

export default function PagedPdfViewer({ url, downloadUrl, visited, onPage, onRendered, paused, lastPageFooter, hint }: {
  url: string;                          // PDF 주소(blob: 도 된다)
  downloadUrl?: string | null;          // 「PDF」 버튼(없으면 숨김)
  visited?: Set<number>;                // 읽은 쪽(쪽 목록에 ✓)
  onPage?: (page: number, total: number) => void;   // 쪽이 바뀌거나 문서가 열릴 때
  onRendered?: (page: number) => void;  // 그 쪽이 실제로 다 그려졌을 때(읽은 쪽 판정은 이것으로 — 못 그린 쪽은 읽은 것으로 치지 않는다)
  paused?: boolean;                     // 위에 다른 창(서명·반려)이 떠 있으면 키보드 ← → 를 쓰지 않는다
  lastPageFooter?: ReactNode;           // 마지막 쪽 아래에 붙는 서명란
  hint?: string;
}) {
  const docRef = useRef<PdfDoc | null>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const taskRef = useRef<{ promise: Promise<void>; cancel: () => void } | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const onPageRef = useRef(onPage);
  useEffect(() => { onPageRef.current = onPage; }, [onPage]);
  const onRenderedRef = useRef(onRendered);
  useEffect(() => { onRenderedRef.current = onRendered; }, [onRendered]);
  const genRef = useRef(0);   // 그리기 세대 — 늦게 끝난 앞 그리기가 지금 쪽을 덮지 않게(검증 F4)

  useEffect(() => acquirePdfRafFallback(), []);

  // 문서 열기
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfjs: any = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const pdf: PdfDoc = await pdfjs.getDocument({ url, withCredentials: true, cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/" }).promise;
        if (!alive) { pdf.destroy?.(); return; }
        docRef.current = pdf;
        setTotal(pdf.numPages); setPage(1); setLoading(false); setError("");
        onPageRef.current?.(1, pdf.numPages);
      } catch (e) {
        if (!alive) return;
        console.error("PDF 열기 실패:", e);
        setError("문서를 여는 중 오류가 발생했습니다."); setLoading(false);
      }
    })();
    return () => {
      alive = false;
      try { taskRef.current?.cancel(); } catch { /* 무시 */ }
      try { docRef.current?.destroy?.(); } catch { /* 무시 */ }
      docRef.current = null;
    };
  }, [url]);

  // 한 쪽 그리기 — 무대 높이·폭 안에 쪽 전체가 들어가게(쪽 맞춤) × 배율
  const draw = useCallback(async () => {
    const pdf = docRef.current, canvas = mainRef.current, stage = stageRef.current;
    if (!pdf || !canvas || !stage || !total) return;
    const gen = ++genRef.current;
    const p = await pdf.getPage(page);
    if (gen !== genRef.current) return;
    const base = p.getViewport({ scale: 1 });
    const fit = Math.min((stage.clientWidth - 32) / base.width, (stage.clientHeight - 24) / base.height);
    const scale = Math.max(0.2, fit) * zoom;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const vp = p.getViewport({ scale: scale * dpr });
    try { taskRef.current?.cancel(); await taskRef.current?.promise; } catch { /* 취소 예외는 정상 */ }
    if (gen !== genRef.current) return;
    canvas.width = vp.width; canvas.height = vp.height;
    canvas.style.width = `${vp.width / dpr}px`; canvas.style.height = `${vp.height / dpr}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const task = p.render({ canvasContext: ctx, viewport: vp });
    taskRef.current = task;
    try {
      await task.promise;
      if (gen === genRef.current) { setError(""); onRenderedRef.current?.(page); }
    } catch (e) { if (gen === genRef.current && (e as { name?: string })?.name !== "RenderingCancelledException") setError("문서를 그리는 중 오류가 발생했습니다."); }
  }, [page, zoom, total]);
  const drawRef = useRef(draw);
  useEffect(() => { drawRef.current = draw; }, [draw]);
  useEffect(() => { let on = true; Promise.resolve().then(() => { if (on) void draw(); }); return () => { on = false; }; }, [draw]);
  // 창 크기가 바뀌면 다시 맞춘다
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let t: ReturnType<typeof setTimeout>;
    let w = stage.clientWidth, h = stage.clientHeight;
    // 한 번만 만든다 — 쪽·배율이 바뀔 때마다 새로 만들면 첫 콜백이 같은 쪽을 한 번 더 그렸다(검증 F3)
    const ro = new ResizeObserver(() => {
      if (Math.abs(stage.clientWidth - w) < 8 && Math.abs(stage.clientHeight - h) < 8) return;
      w = stage.clientWidth; h = stage.clientHeight;
      clearTimeout(t); t = setTimeout(() => void drawRef.current(), 150);
    });
    ro.observe(stage);
    return () => { ro.disconnect(); clearTimeout(t); };
  }, []);

  // 쪽 목록 작은 그림 — 한 번만
  useEffect(() => {
    const pdf = docRef.current, box = thumbsRef.current;
    if (!pdf || !box || !total) return;
    let alive = true;
    (async () => {
      for (let n = 1; n <= total && alive; n++) {
        const c = box.querySelector<HTMLCanvasElement>(`canvas[data-thumb="${n}"]`);
        if (!c) continue;
        try {
          const p = await pdf.getPage(n);
          const base = p.getViewport({ scale: 1 });
          const vp = p.getViewport({ scale: 150 / base.width });
          c.width = vp.width; c.height = vp.height;
          const ctx = c.getContext("2d");
          if (ctx) await p.render({ canvasContext: ctx, viewport: vp }).promise;
        } catch { /* 작은 그림은 못 그려도 본문엔 지장 없다 */ }
      }
    })();
    return () => { alive = false; };
  }, [total]);

  const go = useCallback((n: number) => {
    if (!total) return;
    const next = Math.min(Math.max(1, n), total);
    setPage(next);
    onPageRef.current?.(next, total);
  }, [total]);

  // 키보드 ← → (입력 칸에 쓰는 중이면 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paused) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); go(page - 1); }
      if (e.key === "ArrowRight") { e.preventDefault(); go(page + 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, page, paused]);

  const btn = "inline-flex items-center gap-1 rounded-lg border bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-40";
  return (
    <div className="flex h-full min-h-0">
      {/* 쪽 목록 */}
      <div ref={thumbsRef} className="hidden md:block w-28 shrink-0 overflow-y-auto border-r bg-white px-3 py-3 space-y-3">
        {Array.from({ length: total }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" onClick={() => go(n)} className="relative block w-full text-center" aria-label={`${n}쪽`}>
            <canvas data-thumb={n} className={cn("w-full rounded border bg-white", n === page ? "ring-2 ring-indigo-500" : "")} />
            {visited?.has(n) && <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-white"><Check size={12} /></span>}
            <span className="text-[12px] text-gray-500">{n}{n === total && lastPageFooter ? " · 서명" : ""}</span>
          </button>
        ))}
      </div>
      {/* 가운데 문서 */}
      <div className="flex min-w-0 flex-1 flex-col bg-slate-100">
        <div className="flex flex-wrap items-center justify-center gap-2 border-b bg-slate-50 px-3 py-2">
          <button type="button" className={btn} onClick={() => go(page - 1)} disabled={page <= 1}><ChevronLeft size={15} />이전 쪽</button>
          <span className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700">{total ? `${page} / ${total}쪽` : "—"}{page === total && lastPageFooter ? " · 서명" : ""}</span>
          <button type="button" className={btn} onClick={() => go(page + 1)} disabled={!total || page >= total}>다음 쪽<ChevronRight size={15} /></button>
          <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.2).toFixed(1)))}><Minus size={14} />축소</button>
          <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(2.4, +(z + 0.2).toFixed(1)))}><Plus size={14} />확대</button>
          {downloadUrl && <a href={downloadUrl} target="_blank" rel="noreferrer" className={btn}><Download size={14} />PDF</a>}
          <span className="hidden lg:inline text-xs text-gray-400">{hint ?? "A4 한 쪽씩 · 쪽 맞춤 · 키보드 ← → 로 넘기기"}</span>
        </div>
        <div ref={stageRef} className="relative min-h-0 flex-1 overflow-auto">
          {loading && <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">문서를 불러오는 중입니다…</div>}
          {error && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-500">{error}</div>}
          <div className="flex w-max min-w-full flex-col items-center px-4 py-3">
            <canvas ref={mainRef} className="bg-white shadow" />
          </div>
          {/* 서명란은 넓어지는 틀 밖에 — 무대 폭 기준(폰에서 서명란 폭이 문서를 옆으로 밀던 것, 재검증 N1) */}
          {page === total && lastPageFooter && <div className="mx-auto w-full max-w-[720px] px-4 pb-4">{lastPageFooter}</div>}
        </div>
      </div>
    </div>
  );
}
