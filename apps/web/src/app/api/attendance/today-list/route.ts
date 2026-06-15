import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 오늘 출퇴근한 직원 목록 (관리자=전체, 원장=자기 지점)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  // 오늘 날짜 (UTC 자정 — @db.Date 컬럼과 동일 규칙)
  const now = new Date();
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const branchWhere =
    session.role === "MANAGER" && session.branch ? { branch: session.branch } : {};

  const records = await prisma.attendance.findMany({
    where: {
      date: today,
      clockIn: { not: null }, // 출근 찍은 직원만
      user: { role: { not: "ADMIN" }, isActive: true, ...branchWhere },
    },
    include: {
      user: { select: { id: true, name: true, branch: true, jobGroup: true, position: true } },
    },
    orderBy: { clockIn: "asc" },
  });

  const list = records.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.user.name,
    branch: r.user.branch,
    jobGroup: r.user.jobGroup,
    position: r.user.position,
    status: r.status,
    clockIn: r.clockIn,
    clockOut: r.clockOut,
    minutes: r.clockIn && r.clockOut
      ? Math.round((r.clockOut.getTime() - r.clockIn.getTime()) / 60000)
      : 0,
  }));

  return NextResponse.json({ date: today.toISOString().slice(0, 10), records: list });
}
