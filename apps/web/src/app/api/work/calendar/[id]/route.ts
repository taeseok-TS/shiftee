import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

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

  const { title, description, startDate, endDate, branch, color, managersOnly } = await request.json();
  if (!title?.trim() || !startDate)
    return NextResponse.json({ error: "제목과 시작일을 입력해주세요." }, { status: 400 });

  // 대상 변경 규칙은 등록과 동일: 원장 전용은 branch 없음, 원장의 일반 일정은 자기 지점 고정
  const isManagersOnly = !!managersOnly;
  let finalBranch: string | null = branch || null;
  if (isManagersOnly) finalBranch = null;
  else if (session.role === "MANAGER") finalBranch = session.branch;

  const updated = await prisma.workCalendarEvent.update({
    where: { id },
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      startDate: new Date(startDate),
      endDate: new Date(endDate || startDate),
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
