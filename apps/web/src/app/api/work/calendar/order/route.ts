import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { calendarVisibleWhere, dayOrderScope, DAY_ORDER_MAX, DAY_ORDER_PREFIX } from "@/lib/work-calendar";

// 같은 날 일정 순서 바꾸기(#243, 2026-11-05 권경욱 제안 · 디렉터 「추천대로」, lib/work-calendar DAY_ORDER_PREFIX)
//  · body { date: "YYYY-MM-DD", ids: [...] } — 그날 일정을 새 순서대로(화면에 안 보이게 걸러 둔 것까지 전부)
//  · 원장(대표 지점 순서) · 관리자(본부 순서)만. 지점 순서라 남의 일정(전사 등)도 자리를 정할 수 있다 — 다른 지점 화면은 바뀌지 않는다
//  · 모두 내가 보는 일정이면서 그날에 걸친 것이어야 한다
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGER")
    return NextResponse.json({ error: "같은 날 일정 순서는 원장 · 관리자가 바꿀 수 있습니다." }, { status: 403 });
  const scope = await dayOrderScope(session);
  if (!scope) return NextResponse.json({ error: "소속 지점이 없어 순서를 바꿀 수 없습니다." }, { status: 400 });

  const body = await request.json().catch(() => null);
  const date = typeof body?.date === "string" && YMD.test(body.date) ? body.date : null;
  const day = date ? new Date(`${date}T00:00:00.000Z`) : null;
  if (!date || !day || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date)
    return NextResponse.json({ error: "날짜가 올바르지 않습니다." }, { status: 400 });
  const raw: unknown[] = Array.isArray(body?.ids) ? body.ids : [];
  if (!raw.length || raw.length > DAY_ORDER_MAX) return NextResponse.json({ error: "순서를 바꿀 일정이 올바르지 않습니다." }, { status: 400 });
  const ids = raw.filter((x): x is string => typeof x === "string");
  if (ids.length !== raw.length || new Set(ids).size !== ids.length)
    return NextResponse.json({ error: "순서를 바꿀 일정이 올바르지 않습니다." }, { status: 400 });

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const found = await prisma.workCalendarEvent.count({
    where: { AND: [{ id: { in: ids } }, { startDate: { lte: day } }, { endDate: { gte: day } }, calendarVisibleWhere(session, myBranches)] },
  });
  if (found !== ids.length) return NextResponse.json({ error: "그날 일정이 아닌 것이 있습니다. 새로고침 후 다시 해 주세요." }, { status: 409 });

  const key = `${DAY_ORDER_PREFIX}${scope}:${date}`;
  const value = JSON.stringify(ids);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  return NextResponse.json({ success: true });
}
