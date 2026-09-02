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
// ⚠ cancelAnimationFrame 도 함께 바꿔야 한다. 대체 경로가 돌려주는 것은 setTimeout 핸들인데
// 두 핸들 공간은 서로 무관해서, pdf.js 가 취소하려고 cancelAnimationFrame(핸들) 을 부르면
// ① 그 타이머는 안 멈추고 ② **같은 번호의 무관한 진짜 rAF 콜백이 대신 취소된다**(2026-09-02).
// 우리가 내준 핸들만 따로 기억해 두고, 그것만 clearTimeout 한다.
let refs = 0;
let original: typeof window.requestAnimationFrame | null = null;
let originalCancel: typeof window.cancelAnimationFrame | null = null;
const timerHandles = new Set<number>();

export function acquirePdfRafFallback(): () => void {
  if (typeof window === "undefined") return () => {};
  if (refs++ === 0) {
    original = window.requestAnimationFrame.bind(window);
    originalCancel = window.cancelAnimationFrame.bind(window);
    const orig = original;
    const origCancel = originalCancel;
    window.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      if (!document.hidden) return orig(cb);
      const h = window.setTimeout(() => {
        timerHandles.delete(h);
        cb(performance.now());
      }, 16) as unknown as number;
      timerHandles.add(h);
      return h;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = ((h: number) => {
      if (timerHandles.delete(h)) window.clearTimeout(h);
      else origCancel(h);
    }) as typeof window.cancelAnimationFrame;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--refs === 0 && original) {
      window.requestAnimationFrame = original;
      if (originalCancel) window.cancelAnimationFrame = originalCancel;
      original = null;
      originalCancel = null;
      // 남은 대체 타이머를 정리한다 — 뷰어가 사라진 뒤에 콜백이 도는 것을 막는다
      for (const h of timerHandles) window.clearTimeout(h);
      timerHandles.clear();
    }
  };
}
