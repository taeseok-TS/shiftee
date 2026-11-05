import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { canEditCalendarEvent } from "@/lib/work-calendar";

// 같은 날 안에서 일정 순서 바꾸기(#243, 2026-11-05 권경욱 제안 · 디렉터 「추천대로」)
//  · body { date: "YYYY-MM-DD", ids: [...] } — 그날 내가 고칠 수 있는 일정을 새 순서대로. 앞에서부터 0, 1, 2… 를 넣는다
//  · 모두 그날에 걸친 일정이어야 하고, 하나라도 고칠 권한이 없으면 통째로 거절한다(남의 일정 순서는 못 바꾼다)
//  · 순서가 없는 일정(새 일정 · 남의 일정)은 끌어 정한 일정 뒤에 종일 먼저 · 이른 시각 순으로 온다
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const MAX = 100;

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const date = typeof body?.date === "string" && YMD.test(body.date) ? body.date : null;
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: unknown): x is string => typeof x === "string") : [];
  if (!date || !ids.length || ids.length > MAX || new Set(ids).size !== ids.length)
    return NextResponse.json({ error: "순서를 바꿀 일정이 올바르지 않습니다." }, { status: 400 });
  const day = new Date(`${date}T00:00:00.000Z`);

  const events = await prisma.workCalendarEvent.findMany({ where: { id: { in: ids } } });
  if (events.length !== ids.length) return NextResponse.json({ error: "일정을 찾을 수 없습니다. 새로고침 후 다시 해 주세요." }, { status: 404 });
  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  for (const e of events) {
    if (!canEditCalendarEvent(session, e, myBranches)) return NextResponse.json({ error: "순서를 바꿀 권한이 없는 일정이 있습니다." }, { status: 403 });
    if (e.startDate > day || e.endDate < day) return NextResponse.json({ error: "그날 일정이 아닌 것이 있습니다. 새로고침 후 다시 해 주세요." }, { status: 409 });
  }
  await prisma.$transaction(ids.map((id, i) => prisma.workCalendarEvent.update({ where: { id }, data: { sortOrder: i } })));
  return NextResponse.json({ success: true });
}
