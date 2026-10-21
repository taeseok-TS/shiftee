import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { DEFAULT_COHORTS, ROUTE_COURSE_KEY, parseCohorts } from "@/lib/route-course";

export const dynamic = "force-dynamic";

// 루트코스 기수 일정표(교육평가 기간 기준, 2026-10-21 이예지 대리) — 본부(관리자)만. 저장값이 없으면 2026 확정 일정.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  const row = await prisma.appSetting.findUnique({ where: { key: ROUTE_COURSE_KEY } });
  return NextResponse.json({ cohorts: row ? parseCohorts(row.value) : DEFAULT_COHORTS, saved: !!row });
}

// 일정표 통째로 저장 — 화면이 고친 결과를 보낸다. 바뀐 기수만 변경 로그에
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 고칠 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.cohorts)) return NextResponse.json({ error: "저장할 일정표가 없습니다." }, { status: 400 });
  if (!body.cohorts.length) return NextResponse.json({ error: "기수가 하나도 없는 일정표는 저장하지 않습니다(모든 신규입사 평가 칸이 빈칸이 됩니다)." }, { status: 400 });
  const next = parseCohorts(body.cohorts);
  // 모양이 틀린 줄이 조용히 사라지지 않게 — 보낸 줄 수와 다르면 거절하고 이유를 알린다
  if (next.length !== body.cohorts.length)
    return NextResponse.json({ error: "기수 번호·입과일·수료일을 확인해 주세요 — 날짜가 없거나, 수료일이 입과일보다 빠르거나(60일 넘게 뒤거나), 같은 입과일이 두 번 있는 줄이 있습니다." }, { status: 400 });

  const prevRow = await prisma.appSetting.findUnique({ where: { key: ROUTE_COURSE_KEY } });
  const prev = prevRow ? parseCohorts(prevRow.value) : DEFAULT_COHORTS;
  const value = JSON.stringify(next);
  await prisma.appSetting.upsert({ where: { key: ROUTE_COURSE_KEY }, create: { key: ROUTE_COURSE_KEY, value }, update: { value } });

  const key = (c: { no: string; start: string; end: string }) => `${c.no}|${c.start}|${c.end}`;
  const before = new Set(prev.map(key)), after = new Set(next.map(key));
  const added = next.filter((c) => !before.has(key(c))).map((c) => `${c.no}기 ${c.start}~${c.end}`);
  const removed = prev.filter((c) => !after.has(key(c))).map((c) => `${c.no}기 ${c.start}~${c.end}`);
  if (added.length || removed.length)
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "ROUTE_COURSE_SCHEDULE_UPDATE",
      targetType: "AppSetting", targetId: ROUTE_COURSE_KEY, targetName: "루트코스 일정표",
      detail: [added.length ? `넣음 ${added.join(", ")}` : "", removed.length ? `뺌 ${removed.join(", ")}` : ""].filter(Boolean).join(" · ").slice(0, 900),
    });
  return NextResponse.json({ cohorts: next, saved: true });
}
