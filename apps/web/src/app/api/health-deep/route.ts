import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// 깊은 헬스체크 (2026-09-04, 검증관 C M-5)
//
// 도커 헬스체크는 /api/health-beat 만 본다 — 그건 Next 가 응답한다는 것만 증명한다.
// **DB 가 죽어도 healthy 로 보인다.** 실제로 업무가 되는지는 DB 를 한 번 만져 봐야 안다.
//
// 이 주소는 **앱 밖 감시(호스트 워치독)** 가 1분마다 부른다. 도커 헬스체크에는 쓰지 않는다 —
// DB 가 잠깐 흔들릴 때 컨테이너를 재시작해 버리면 오히려 장애를 키운다.
// 판단(재시작할지, 알릴지)은 워치독이 한다. 여기서는 사실만 알려준다.
//
// 인증을 걸지 않는다(워치독이 앱 밖에서 부르므로). 대신 두 가지를 지킨다:
//  ① 결과를 잠깐 캐시한다 — 무인증 주소가 요청마다 DB 를 찌르면 **커넥션 풀(기본 5개)이
//     고갈**돼 실사용자가 pool timeout 을 받는다. 그것도 하필 DB 가 느려진 장애 중에
//     (2026-09-04 검증관 A H-1). 캐시가 있으면 아무리 때려도 5초에 한 번만 DB 를 본다.
//  ② 오류 메시지를 그대로 내보내지 않는다 — Prisma 메시지에는 내부 호스트.포트가 들어 있다.
export const dynamic = "force-dynamic";

const CACHE_MS = 5000;
let cached: { at: number; ok: boolean; ms: number } | null = null;
let inflight: Promise<{ ok: boolean; ms: number }> | null = null;

async function probe(): Promise<{ ok: boolean; ms: number }> {
  const t = Date.now();
  // ⚠ Promise.race 만으로는 쿼리가 안 멈춘다 — 응답만 먼저 돌려주고 커넥션은 계속 잡고 있다.
  //   타이머는 반드시 정리한다(요청마다 4초짜리 타이머가 큐에 쌓이던 것).
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("db timeout")), 4000); }),
    ]);
    return { ok: true, ms: Date.now() - t };
  } catch {
    return { ok: false, ms: Date.now() - t };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS)
    return NextResponse.json({ ok: cached.ok, db: cached.ok, ms: cached.ms, cached: true },
      { status: cached.ok ? 200 : 503 });
  // 캐시가 만료된 순간 동시에 들어와도 DB 조회는 한 번만 (풀 고갈 방지)
  const p = inflight ?? (inflight = probe().finally(() => { inflight = null; }));
  const r = await p;
  cached = { at: Date.now(), ok: r.ok, ms: r.ms };
  return NextResponse.json({ ok: r.ok, db: r.ok, ms: r.ms }, { status: r.ok ? 200 : 503 });
}
