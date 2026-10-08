import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runLeaveGrants } from "@/lib/leave-grant";

export const dynamic = "force-dynamic";

const ymdOk = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

// 자동 부여 점검을 지금 돌린다(2026-10-08 QA76 #56) — 본부만. { from, to } (기간 상한 400일). 매일 밤 점검과 같은 계산
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부만 할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (!ymdOk(body.from) || !ymdOk(body.to) || body.from > body.to) return NextResponse.json({ error: "기간을 올바르게 넣어 주세요." }, { status: 400 });
  const from = new Date(`${body.from}T00:00:00Z`), to = new Date(`${body.to}T00:00:00Z`);
  if (to.getTime() - from.getTime() > 400 * 86400000) return NextResponse.json({ error: "한 번에 400일까지 점검할 수 있습니다." }, { status: 400 });
  const result = await runLeaveGrants({ from, to }, { userId: session.userId, name: session.name });
  return NextResponse.json({ success: true, ...result });
}
