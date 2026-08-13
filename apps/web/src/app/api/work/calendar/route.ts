import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

// 회사/지점 전체 일정 조회 (개인 일정 아님, 근무일정·휴가와 비연동)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));

  // 해당 월에 걸치는 일정 (시작 ≤ 말일 && 종료 ≥ 1일)
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  // 전사(branch=null) + 본인 지점(원장은 담당 지점 목록 — 대표+겸직). 원장 전용(managersOnly)은 원장·관리자에게만 노출(직원 제외)
  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const branchFilter =
    session.role === "ADMIN"
      ? {} // 관리자는 전체 열람
      : session.role === "MANAGER"
      ? { OR: [{ branch: null }, { branch: { in: myBranches } }] }
      : { AND: [{ OR: [{ branch: null }, { branch: session.branch }] }, { managersOnly: false }] };

  const events = await prisma.workCalendarEvent.findMany({
    where: {
      startDate: { lte: monthEnd },
      endDate: { gte: monthStart },
      ...branchFilter,
    },
    orderBy: { startDate: "asc" },
  });

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      startDate: e.startDate,
      endDate: e.endDate,
      branch: e.branch, // null = 전사
      managersOnly: e.managersOnly,
      color: e.color,
      canEdit:
        session.role === "ADMIN" ||
        e.createdBy === session.userId ||
        (session.role === "MANAGER" && !e.managersOnly && !!e.branch && myBranches.includes(e.branch)),
    })),
  });
}

// 일정 등록 (관리자=전사·전지점, 원장=자기 지점만)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE")
    return NextResponse.json({ error: "일정 등록 권한이 없습니다." }, { status: 403 });

  const { title, description, startDate, endDate, branch, color, managersOnly } = await request.json();
  if (!title?.trim() || !startDate)
    return NextResponse.json({ error: "제목과 시작일을 입력해주세요." }, { status: 400 });

  // 원장 전용 일정: branch 없이 전 원장 대상 (관리자·원장 모두 등록 가능)
  // 일반 일정: 원장은 자기 지점만 등록 가능 (전사 일정 불가)
  const isManagersOnly = !!managersOnly;
  let finalBranch: string | null = branch || null;
  if (isManagersOnly) {
    finalBranch = null;
  } else if (session.role === "MANAGER") {
    finalBranch = session.branch;
  }

  const event = await prisma.workCalendarEvent.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      startDate: new Date(startDate),
      endDate: new Date(endDate || startDate),
      branch: finalBranch,
      managersOnly: isManagersOnly,
      color: color || "indigo",
      createdBy: session.userId,
    },
  });
  return NextResponse.json({ success: true, event });
}
