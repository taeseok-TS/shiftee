// Next.js 서버 기동 시 1회 실행 — 큐브티 봇 스케줄러 시작
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBotScheduler } = await import("@/lib/bot");
    startBotScheduler();
  }
}

// 서버(라우트 핸들러/서버 컴포넌트)에서 잡히지 않은 오류를 DB에 기록 → 관리자 "시스템 로그"에서 확인
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { logSystemError } = await import("@/lib/monitor");
    const e = err as { message?: string; stack?: string };
    await logSystemError({
      path: request.path,
      method: request.method,
      message: e?.message || String(err),
      stack: e?.stack || null,
    });
  } catch {
    // 로그 실패는 무시
  }
}
