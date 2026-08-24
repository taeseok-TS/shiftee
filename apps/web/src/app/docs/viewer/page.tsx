"use client";

// 계약서 인앱 뷰어 — MS 오피스 온라인 뷰어(20초+) 대신 브라우저에서 직접 렌더링(1초 이내).
// docx-preview(셀프호스팅 /vendor)가 워드 파일을 그대로 그린다. 앱 WebView에서도 동일 사용.
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

declare global {
  interface Window {
    JSZip?: unknown;
    docx?: { renderAsync: (blob: Blob, el: HTMLElement, styleEl: HTMLElement | null, opts?: Record<string, unknown>) => Promise<void> };
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`스크립트 로드 실패: ${src}`));
    document.head.appendChild(s);
  });
}

function DocViewer() {
  const params = useSearchParams();
  const src = params.get("src") || "";
  const containerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "done" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");

  // 축소 배율에 맞춰 표 선 두께를 키운다 — 0.5pt 선이 모바일 축소(×0.4~0.5) 후
  // 0.3px 이하가 되어 화면에서 사라지는 문제(개선 제안 2026-08-24 — 사직원 선 안 보임).
  // docx-preview 는 테두리를 td 인라인 스타일로 넣으므로 원본값을 dataset 에 보관해 두고
  // 매번 원본 기준으로 계산한다(리사이즈 반복 호출에도 안전).
  const boostBorders = (el: HTMLElement, scale: number) => {
    const SIDES = ["Top", "Right", "Bottom", "Left"] as const;
    el.querySelectorAll<HTMLElement>("td, th, table").forEach((cell) => {
      SIDES.forEach((side) => {
        const prop = `border${side}Width` as "borderTopWidth";
        const key = `ow${side}`;
        if (cell.dataset[key] === undefined) cell.dataset[key] = cell.style[prop] || "";
        const orig = cell.dataset[key];
        if (!orig) return; // 원래 테두리 없는 변은 건드리지 않는다
        const origPx = parseFloat(orig) * (orig.endsWith("pt") ? 4 / 3 : 1);
        if (!origPx) return;
        // 축소 후 최소 1px 은 보이게 — 상한 3.2px (320px 급 좁은 화면·가로형 문서의
        // scale 0.32 까지 렌더 1px 유지, 검증관 지적)
        const target = scale < 1 ? Math.max(origPx, Math.min(3.2, 1 / scale)) : origPx;
        cell.style[prop] = scale < 1 ? `${target.toFixed(2)}px` : orig;
      });
    });
  };

  // 문서 원본 폭이 화면보다 넓으면(모바일) 통째로 축소해서 한 화면에 맞춤 — 잘림 방지
  const applyScale = () => {
    const el = containerRef.current;
    const outer = outerRef.current;
    if (!el || !outer) return;
    const section = el.querySelector("section.docx") as HTMLElement | null;
    if (!section) return;
    const naturalW = section.offsetWidth; // transform 영향 없는 원본 폭
    const avail = document.documentElement.clientWidth - 8;
    const scale = Math.min(1, avail / naturalW);
    boostBorders(el, scale);
    if (scale < 1) {
      // 래퍼가 flex 중앙정렬이라 컨테이너가 문서보다 좁으면 좌측이 화면 밖으로 밀림
      // → 컨테이너 폭을 문서 원본 폭(+래퍼 패딩)으로 고정한 뒤 통째로 축소
      el.style.width = `${naturalW + 16}px`;
      el.style.transform = `scale(${scale})`;
      el.style.transformOrigin = "top left";
      el.style.marginLeft = `${Math.max(0, (document.documentElement.clientWidth - (naturalW + 16) * scale) / 2)}px`;
      outer.style.height = `${el.scrollHeight * scale}px`;
      outer.style.overflow = "hidden";
    } else {
      el.style.width = "";
      el.style.transform = "";
      el.style.marginLeft = "";
      outer.style.height = "";
      outer.style.overflow = "";
    }
  };

  useEffect(() => {
    const onResize = () => applyScale();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // 같은 서버의 업로드 파일만 허용 (외부 URL 차단)
        let path = src;
        try { if (/^https?:\/\//i.test(path)) path = new URL(path).pathname + new URL(path).search; } catch { /* 그대로 */ }
        if (!path.startsWith("/api/uploads/")) throw new Error("지원하지 않는 문서 경로입니다.");

        await loadScript("/vendor/jszip.min.js");
        await loadScript("/vendor/docx-preview.min.js");

        const res = await fetch(path);
        if (!res.ok) throw new Error(`문서를 불러오지 못했습니다. (${res.status})`);
        const blob = await res.blob();
        if (cancelled || !containerRef.current || !window.docx) return;
        containerRef.current.innerHTML = "";
        await window.docx.renderAsync(blob, containerRef.current, null, {
          inWrapper: true,
          ignoreLastRenderedPageBreak: true,
        });
        if (!cancelled) {
          setStatus("done");
          applyScale();
          // 폰트 로딩 등으로 폭이 늦게 확정되는 경우 대비 재계산
          setTimeout(applyScale, 150);
        }
      } catch (e) {
        if (!cancelled) { setErrMsg(e instanceof Error ? e.message : "문서 표시 중 오류"); setStatus("error"); }
      }
    })();
    return () => { cancelled = true; };
  }, [src]);

  return (
    <div style={{ minHeight: "100vh", background: "#525659" }}>
      {status === "loading" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", color: "#e5e7eb", gap: 12 }}>
          <div style={{ width: 36, height: 36, border: "3px solid #9ca3af", borderTopColor: "#fff", borderRadius: "50%", animation: "docspin 0.8s linear infinite" }} />
          <p style={{ fontSize: 14 }}>문서를 불러오는 중…</p>
          <style>{`@keyframes docspin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      {status === "error" && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "#fca5a5", fontSize: 14, padding: 20, textAlign: "center" }}>
          {errMsg}
        </div>
      )}
      <div ref={outerRef} style={{ display: status === "done" ? "block" : "none" }}>
        <div ref={containerRef} />
      </div>
      <style>{`
        .docx-wrapper { background: #525659 !important; padding: 16px 8px !important; }
        .docx-wrapper > section.docx { box-shadow: 0 2px 8px rgba(0,0,0,0.35); margin-bottom: 16px; }
      `}</style>
    </div>
  );
}

export default function DocViewerPage() {
  return (
    <Suspense fallback={null}>
      <DocViewer />
    </Suspense>
  );
}
