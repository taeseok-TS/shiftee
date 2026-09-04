import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// 깊은 헬스체크 (2026-09-04, 검증관 C M-5)
//
// 도커 헬스체크는 /api/health-beat 만 본다 — 그건 Next 가 응답한다는 것만 증명한다.
// **DB 가 죽어도 healthy 로 보인다.** 실제로 업무가 되는지는 DB 를 한 번 만져 봐야 안다.
//
// 이 주소는 **앱 밖 감시(호스트 워치독)** 가 부른다. 도커 헬스체크에는 쓰지 않는다 —
// DB 가 잠깐 흔들릴 때 컨테이너를 재시작해 버리면 오히려 장애를 키운다.
// 판단(재시작할지, 알릴지)은 워치독이 한다. 여기서는 사실만 알려준다.
//
// 인증을 걸지 않는다. 아무 데이터도 주지 않고 ok/에러 종류만 알린다.
export const dynamic = "force-dynamic";

export async function GET() {
  const t = Date.now();
  try {
    // 타임아웃을 걸어 둔다 — DB 가 멈춰 있으면 이 요청이 영원히 안 끝나 워치독도 같이 멈춘다.
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, rej) => setTimeout(() => rej(new Error("db timeout")), 4000)),
    ]);
  } catch (e) {
    return NextResponse.json(
      { ok: false, db: false, ms: Date.now() - t, error: e instanceof Error ? e.message : "db error" },
      { status: 503 }
    );
  }
  return NextResponse.json({ ok: true, db: true, ms: Date.now() - t });
}
