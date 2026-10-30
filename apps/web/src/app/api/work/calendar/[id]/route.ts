import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { myBranch, parseEventTimes } from "@/lib/work-calendar";

// 일정 수정 (관리자 / 등록자 본인 / 해당 지점 원장)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const event = await prisma.workCalendarEvent.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const canEdit =
    session.role === "ADMIN" ||
    event.createdBy === session.userId ||
    (session.role === "MANAGER" && !event.managersOnly && !!event.branch && myBranches.includes(event.branch));
  if (!canEdit) return NextResponse.json({ error: "수정 권한이 없습니다." }, { status: 403 });

  const { title, description, startDate, endDate, branch, color, managersOnly, startTime, endTime } = await request.json();
  if (!title?.trim() || !startDate)
    return NextResponse.json({ error: "제목과 시작일을 입력해주세요." }, { status: 400 });
  const times = parseEventTimes(startTime, endTime, !endDate || endDate === startDate); // #221 시각(선택) — 비워 보내면 종일로 바뀐다
  if ("error" in times) return NextResponse.json({ error: times.error }, { status: 400 });

  // 대상 변경 규칙은 등록과 동일: 원장 전용은 branch 없음, 원장의 일반 일정은 자기 지점 고정
  const isManagersOnly = session.role !== "EMPLOYEE" && !!managersOnly; // 직원은 원장 전용으로 바꿀 수 없다
  let finalBranch: string | null = branch || null;
  if (isManagersOnly) finalBranch = null;
  else if (session.role === "MANAGER") {
    // 담당 지점(대표+겸직) 안에서 고른 지점은 그대로 — 대표 지점으로 덮으면 겸직 지점 일정이 옮겨졌다(2026-10-30 검증).
    // 담당 밖이면 원래 지점(담당 지점일 때) → 대표 지점 순. 셋 다 없으면 전사 일정이 되어 버려 막는다
    finalBranch = finalBranch && myBranches.includes(finalBranch) ? finalBranch
      : event.branch && myBranches.includes(event.branch) ? event.branch
      : session.branch && myBranches.includes(session.branch) ? session.branch : myBranches[0] ?? null;   // 토큰의 대표 지점도 지금 담당인지 확인(검증 W2)
    if (!finalBranch) return NextResponse.json({ error: "소속 지점이 없어 일정을 고칠 수 없습니다." }, { status: 400 });
  } else if (session.role === "EMPLOYEE") {
    finalBranch = await myBranch(session.userId); // 직원은 자기 지점 고정(2026-10-20)
    if (!finalBranch) return NextResponse.json({ error: "소속 지점이 없어 일정을 고칠 수 없습니다." }, { status: 403 });
  }

  const updated = await prisma.workCalendarEvent.update({
    where: { id },
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      startDate: new Date(startDate),
      endDate: new Date(endDate || startDate),
      startTime: times.startTime,
      endTime: times.endTime,
      branch: finalBranch,
      managersOnly: isManagersOnly,
      color: color || "indigo",
    },
  });
  return NextResponse.json({ success: true, event: updated });
}

// 일정 삭제 (관리자 또는 해당 지점 원장)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const event = await prisma.workCalendarEvent.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "일정을 찾을 수 없습니다." }, { status: 404 });

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const canEdit =
    session.role === "ADMIN" ||
    event.createdBy === session.userId ||
    (session.role === "MANAGER" && !event.managersOnly && !!event.branch && myBranches.includes(event.branch));
  if (!canEdit) return NextResponse.json({ error: "삭제 권한이 없습니다." }, { status: 403 });

  await prisma.workCalendarEvent.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
