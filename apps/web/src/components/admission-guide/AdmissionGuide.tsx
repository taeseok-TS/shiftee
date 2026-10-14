"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { ADMISSION_GUIDE_CSS, ADMISSION_GUIDE_FONTS } from "./admission-guide-style";

/*
 * 고입 기본계획 화면 틀(진학입시EX 에서 옮김). 본문 HTML 을 그대로 넣고, 화면 스크립트 run(root, data, host, ctx) 를 돌린 뒤
 * 떠날 때 run 이 돌려준 정리 함수로 리스너·타이머·window 전역 이름을 치운다. React 는 본문 안을 건드리지 않는다(스크립트가 DOM 을 직접 고침).
 *  - assetBase: 본문의 __ASSET__ 자리. 원문 PDF 를 public/admission-guide/ 에 두었으면 "/admission-guide" → "/admission-guide/local/2027seoul-admission.pdf"
 *  - stickyTop: 앱 머리(붙박이)의 높이. 화면 안 붙박이 머리줄이 그 밑에 붙는다. 앱 머리가 없거나 붙박이가 아니면 "0px"
 *  - 같은 화면에 두 지역을 동시에 띄우지 않는다(스크립트가 화면이 떠 있는 동안 window 에 showSection 등 이름을 건다)
 */
type Run = (root: HTMLElement, data: unknown, host: HTMLElement, ctx: Record<string, string>) => (() => void) | void;

const NO_DATA = {};
const NO_CTX: Record<string, string> = {};

export function AdmissionGuide({ body, run, assetBase, stickyTop = "0px" }: { body: string; run: Run; assetBase: string; stickyTop?: string }) {
  const rootEl = useRef<HTMLDivElement | null>(null);
  const hostEl = useRef<HTMLDivElement | null>(null);
  const html = useMemo(() => body.replaceAll("__ASSET__", assetBase.replace(/\/$/, "")), [body, assetBase]);

  // 칠하기 전에 스크립트를 돌린다. 돌리기 전에 본문을 새로 채운다(개발 모드 두 번 실행 때 앞 실행이 고친 DOM 이 남지 않게)
  useLayoutEffect(() => {
    const root = rootEl.current;
    const host = hostEl.current;
    if (!root || !host) return;
    root.innerHTML = html;
    const stop = run(root, NO_DATA, host, NO_CTX);
    return () => {
      if (typeof stop === "function") stop();
    };
  }, [html, run]);

  return (
    // overflowX clip: 스타일의 overflow-x:hidden 이 이 상자에 걸리면 상자가 스크롤 상자가 되어 안쪽 머리줄·메뉴가 위에 붙지 않는다(검증 지적) — clip 은 잘라도 스크롤 상자가 아니다
    <div ref={hostEl} className="admission-guide" style={{ position: "relative", isolation: "isolate", overflowX: "clip", ["--info-head" as string]: stickyTop }}>
      {ADMISSION_GUIDE_FONTS.map((href) => (
        <link key={href} rel="stylesheet" href={href} precedence="default" />
      ))}
      <style>{ADMISSION_GUIDE_CSS}</style>
      <div ref={rootEl} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
