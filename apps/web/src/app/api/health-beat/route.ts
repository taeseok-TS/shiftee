import { NextResponse } from "next/server";

// 접근 로그 하트비트 (2026-09-03).
// 봇이 매시 30분에 **프록시를 통해** 이 주소를 부른다. 그러면 접근 로그에 한 줄이 반드시 남고,
// "로그가 갱신되지 않는다 = 감시가 멈췄다" 판정을 사람 접속 여부와 무관하게 할 수 있다.
// 인증을 걸지 않는다 — 아무 정보도 주지 않고, 로그에 한 줄을 남기는 것이 전부다.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
