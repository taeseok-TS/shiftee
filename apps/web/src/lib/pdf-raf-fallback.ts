// PDF.js 렌더가 숨겨진 화면에서 멈추는 것을 막는다 (2026-09-01)
//
// pdfjs 4.x 는 한 페이지를 여러 조각으로 나눠 그리고, 조각과 조각 사이를
// window.requestAnimationFrame 으로 잇는다(InternalRenderTask._scheduleNext).
// 그런데 브라우저는 문서가 hidden 이면 rAF 를 아예 호출하지 않는다. 그래서
// 배경 탭·자동화 브라우저·비활성 WebView 에서는 render() 가 성공도 실패도 하지
// 않고 영원히 멈춘다(캔버스도 점유된 채 남아 다시 그리려 하면 거부당한다).
//
// hidden 일 때만 타이머로 대신 잇는다. 화면이 보이는 동안은 원본 그대로라
// 렌더 품질·성능에 영향이 없다. 전역 함수를 바꾸므로 뷰어가 떠 있는 동안만
// 켜고, 마지막 뷰어가 사라지면 되돌린다.
let refs = 0;
let original: typeof window.requestAnimationFrame | null = null;

export function acquirePdfRafFallback(): () => void {
  if (typeof window === "undefined") return () => {};
  if (refs++ === 0) {
    original = window.requestAnimationFrame.bind(window);
    const orig = original;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      document.hidden
        ? (window.setTimeout(() => cb(performance.now()), 16) as unknown as number)
        : orig(cb)) as typeof window.requestAnimationFrame;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--refs === 0 && original) {
      window.requestAnimationFrame = original;
      original = null;
    }
  };
}
