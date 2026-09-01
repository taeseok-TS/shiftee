"use client";

// 계약서 뷰어 (PDF.js) — 2026-09-01
//
// 왜 브라우저 내장 PDF 뷰어를 버렸나 (개선 제안 #179 #180 #182 #196 #197)
//  · iframe 안의 PDF 는 스크롤 위치를 바깥에 알려주지 않는다. 그래서 "전문을 끝까지 읽으면
//    확인 버튼 활성화"(#182)를 만들 수 없어 시간 대기로 대체했었고, 그 방식이 불편하다는
//    지적을 다시 받았다. 여기서는 스크롤을 직접 다루므로 끝 도달을 정확히 판정한다.
//  · 문서가 영역 폭에 맞춰지지 않아 오른쪽이 잘렸다(#197). 여기서는 컨테이너 폭에 맞춰 그린다.
//  · 확대하면 화질이 깨진다는 지적(#180) — 글꼴이 살아 있는 벡터를 배율만큼 다시 그리므로
//    키워도 선명하다(이미지로 미리 뽑는 방식이었다면 깨졌을 것이다).
//  · 보이는 페이지만 그려서 첫 화면이 빨리 뜬다(#179).
//  · 안드로이드 WebView 는 내장 PDF 렌더러가 없어 앱에서 문서가 백지로 떴는데(2026-08-28),
//    PDF.js 는 순수 자바스크립트라 WebView 안에서도 그대로 열린다.
import { useCallback, useEffect, useRef, useState } from "react";
import { acquirePdfRafFallback } from "@/lib/pdf-raf-fallback";

type Props = {
  /** 문서 주소 (PDF 또는 /api/docs/pdf?src=... 변환 주소) */
  url: string;
  /** 마지막 페이지 끝까지 스크롤했을 때 한 번 호출 */
  onReachEnd?: () => void;
  /** 바깥에서 배율을 조절하고 싶을 때 (1 = 폭 맞춤) */
  zoom?: number;
  className?: string;
  style?: React.CSSProperties;
  /** 페이지 수를 알게 됐을 때 */
  onLoaded?: (numPages: number) => void;
};

export default function PdfViewer({ url, onReachEnd, zoom = 1, className = "", style, onLoaded }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const docRef = useRef<any>(null);
  const renderedRef = useRef<Set<number>>(new Set());
  // 페이지별 진행 중인 렌더 작업. 같은 캔버스에 렌더를 겹쳐 걸면 pdfjs 가
  // "Cannot use the same canvas during multiple render() operations" 로 거부한다
  // (확대 버튼을 연타하면 실제로 걸린다) — 이전 작업을 취소하고 끝날 때까지 기다린 뒤 다시 그린다.
  const tasksRef = useRef<Map<number, any>>(new Map());
  const reachedRef = useRef(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // 콜백을 의존성에 두면 부모가 인라인 함수를 넘길 때마다 문서를 다시 연다 — ref 로 잡아둔다
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const onReachEndRef = useRef(onReachEnd);
  onReachEndRef.current = onReachEnd;

  // 한 페이지를 캔버스에 그린다. 컨테이너 폭 기준이라 항상 폭에 맞는다.
  const renderPage = useCallback(async (pageNo: number, canvas: HTMLCanvasElement) => {
    const pdf = docRef.current;
    if (!pdf) return;
    const page = await pdf.getPage(pageNo);
    const wrap = wrapRef.current;
    const avail = (wrap?.clientWidth || 800) - 24;           // 좌우 여백
    const base = page.getViewport({ scale: 1 });
    const scale = (avail / base.width) * zoomRef.current;
    // 고해상도 화면에서 흐려지지 않도록 DPR 을 곱해 그린다 (최대 2배까지만 — 메모리 보호)
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const viewport = page.getViewport({ scale: scale * dpr });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    // 높이는 지정하지 않는다. 컨테이너가 캔버스보다 좁으면 max-width 가 가로를 줄이는데,
    // 세로를 인라인으로 박아두면 그대로 남아 문서가 세로로 늘어난다(h-auto 로 비율 유지).
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const prev = tasksRef.current.get(pageNo);
    if (prev) {
      try { prev.cancel(); } catch { /* 무시 */ }
      // 취소는 비동기다. 끝나기 전에 새 render 를 걸면 캔버스가 잠긴 채로 거부당한다.
      try { await prev.promise; } catch { /* 취소 예외는 정상 */ }
    }

    // pdfjs v4 의 render 는 canvasContext + viewport 만 받는다(canvas 키는 v5 부터).
    // 렌더는 rAF 로 조각을 이어 그리므로 화면이 숨겨져 있으면 멈춘다 — pdf-raf-fallback 참고.
    const task = page.render({ canvasContext: ctx, viewport });
    tasksRef.current.set(pageNo, task);
    try {
      await task.promise;
    } finally {
      if (tasksRef.current.get(pageNo) === task) tasksRef.current.delete(pageNo);
    }
  }, []);

  // 문서 열기
  // 화면이 숨겨진 동안에도 렌더가 진행되도록 보완 (뷰어가 떠 있는 동안만)
  useEffect(() => acquirePdfRafFallback(), []);

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(""); setPages(0);
    renderedRef.current = new Set();
    reachedRef.current = false;

    (async () => {
      try {
        const pdfjs: any = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        // 한글 문서는 CID 글꼴을 쓴다. 이 경로가 없으면 글자가 빠진 채로 그려질 수 있다.
        const task = pdfjs.getDocument({
          url,
          withCredentials: true,
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
          standardFontDataUrl: "/pdfjs/standard_fonts/",
        });
        const pdf = await task.promise;
        if (!alive) return;
        docRef.current = pdf;
        setPages(pdf.numPages);
        setLoading(false);
        onLoadedRef.current?.(pdf.numPages);
      } catch (e) {
        if (!alive) return;
        console.error("PDF 열기 실패:", e);
        setError("문서를 여는 중 오류가 발생했습니다.");
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
      for (const t of tasksRef.current.values()) { try { t.cancel(); } catch { /* 무시 */ } }
      tasksRef.current.clear();
      try { docRef.current?.destroy?.(); } catch { /* 무시 */ }
      docRef.current = null;
    };
  }, [url]);

  // 보이는 페이지만 그린다 (첫 화면을 빨리 띄우기 위해)
  useEffect(() => {
    if (!pages) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const canvas = en.target as HTMLCanvasElement;
          const no = Number(canvas.dataset.page);
          if (!no || renderedRef.current.has(no)) continue;
          renderedRef.current.add(no);
          renderPage(no, canvas).catch((e) => {
            renderedRef.current.delete(no);   // 다시 보이면 재시도
            if (e?.name === "RenderingCancelledException") return;   // 배율 변경 등 정상 취소
            console.error("페이지 렌더 실패:", e);
            setError("문서를 그리는 중 오류가 발생했습니다.");
          });
        }
      },
      { root: wrap, rootMargin: "300px 0px" }
    );
    wrap.querySelectorAll("canvas[data-page]").forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [pages, renderPage]);

  // 보이는 페이지를 지금 폭·배율로 다시 그린다
  const redrawVisible = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    renderedRef.current = new Set();
    const wrapRect = wrap.getBoundingClientRect();
    wrap.querySelectorAll("canvas[data-page]").forEach((c) => {
      const canvas = c as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      if (rect.bottom < wrapRect.top - 300 || rect.top > wrapRect.bottom + 300) return;
      const no = Number(canvas.dataset.page);
      renderedRef.current.add(no);
      renderPage(no, canvas).catch(() => renderedRef.current.delete(no));
    });
  }, [renderPage]);

  // 배율이 바뀌면 다시 그린다
  useEffect(() => {
    if (!pages) return;
    redrawVisible();
  }, [zoom, pages, redrawVisible]);

  // 영역 폭이 바뀌면 다시 그린다.
  // 모달은 열리는 동안 폭이 변하는데, 그 사이에 그리면 폭이 어긋난 채 굳는다 (#197).
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !pages) return;
    let last = wrap.clientWidth;
    let timer: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth;
      if (Math.abs(w - last) < 8) return;   // 스크롤바 정도의 변화는 무시
      last = w;
      clearTimeout(timer);
      timer = setTimeout(redrawVisible, 150);
    });
    ro.observe(wrap);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, [pages, redrawVisible]);

  // 끝까지 읽었는지 판정 — 마지막 페이지 하단이 보이면 통과 (#182)
  const handleScroll = useCallback(() => {
    if (reachedRef.current || !onReachEndRef.current) return;
    const el = wrapRef.current;
    if (!el) return;
    // 문서가 한 화면에 다 들어오면 스크롤이 없으므로 즉시 통과시킨다
    const noScroll = el.scrollHeight <= el.clientHeight + 4;
    if (noScroll || el.scrollTop + el.clientHeight >= el.scrollHeight - 24) {
      reachedRef.current = true;
      onReachEndRef.current();
    }
  }, []);

  // 렌더가 끝난 뒤에도 한 번 확인 (짧은 문서 대비)
  useEffect(() => {
    if (!pages) return;
    const t = setTimeout(handleScroll, 400);
    return () => clearTimeout(t);
  }, [pages, handleScroll]);

  return (
    <div
      ref={wrapRef}
      onScroll={handleScroll}
      style={style}
      className={`relative overflow-auto bg-gray-100 ${className}`}
    >
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-white/80 pointer-events-none">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-indigo-500" />
          <span className="text-xs text-gray-500">문서를 불러오는 중입니다…</span>
        </div>
      )}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-500">
          {error}
        </div>
      )}
      <div className="flex flex-col items-center gap-3 py-3">
        {Array.from({ length: pages }, (_, i) => (
          <canvas
            key={i + 1}
            data-page={i + 1}
            className="bg-white shadow-sm max-w-full h-auto"
            style={{ minHeight: pages ? 40 : 0 }}
          />
        ))}
      </div>
    </div>
  );
}
