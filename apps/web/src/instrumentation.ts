// Next.js 서버 기동 시 1회 실행 — 큐브티 봇 스케줄러 시작
export async function register() {
  // 휴가 유형(본부가 만든 유형·숨김) 적재(#216-1) — 서버가 뜰 때 한 번, 그 뒤 60초마다. 실패해도 기본 유형으로 돈다
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { ensureLeaveCatalog } = await import("@/lib/leave-catalog-db");
      await ensureLeaveCatalog().catch(() => {});
      setInterval(() => { ensureLeaveCatalog().catch(() => {}); }, 60_000).unref?.();
    } catch { /* 적재 모듈이 없으면 기본 유형만 */ }
  }
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
