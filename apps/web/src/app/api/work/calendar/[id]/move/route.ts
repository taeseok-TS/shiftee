import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { canEditCalendarEvent } from "@/lib/work-calendar";

// 일정을 다른 날로 끌어 옮기기(#243, 2026-11-05 권경욱 제안 · 디렉터 「추천대로」)
//  · body { startDate: "YYYY-MM-DD" } — 여러 날 일정은 기간을 그대로 두고 통째로 옮긴다(끝 날짜도 같은 만큼)
//  · 권한은 수정과 같다(관리자 · 등록자 · 그 지점 원장). 제목 · 시각 · 대상은 그대로
//  · 옮긴 날에서는 끌어 정한 순서를 비운다(그날 종일 먼저 · 이른 시각 순 자리로)
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400_000;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const startDate = typeof body?.startDate === "string" ? body.startDate : "";
  const to = YMD.test(startDate) ? new Date(`${startDate}T00:00:00.000Z`) : null;
  if (!to || Number.isNaN(to.getTime()) || to.toISOString().slice(0, 10) !== startDate)
    return NextResponse.json({ error: "옮길 날짜가 올바르지 않습니다." }, { status: 400 });

  const event = await prisma.workCalendarEvent.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });
  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  if (!canEditCalendarEvent(session, event, myBranches)) return NextResponse.json({ error: "옮길 권한이 없습니다." }, { status: 403 });

  const length = Math.round((event.endDate.getTime() - event.startDate.getTime()) / DAY);
  const updated = await prisma.workCalendarEvent.update({
    where: { id },
    data: { startDate: to, endDate: new Date(to.getTime() + Math.max(0, length) * DAY), sortOrder: null },
  });
  return NextResponse.json({ success: true, event: updated });
}
