import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

const stepInclude = {
  steps: {
    include: { approver: { select: { id: true, name: true, position: true, department: true, branch: true } } },
    orderBy: { order: "asc" as const },
  },
};

// 전체 직원 + 결재라인(용도별 3개) 조회 (관리자) / 본인 결재라인 조회 (모든 역할)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const myLines = await prisma.approvalLine.findMany({
    where: { userId: session.userId },
    include: stepInclude,
  });
  // 하위호환: 단일 line = 연차(2일+) 라인 우선
  const myLine = myLines.find((l) => l.purpose === "LEAVE_2PLUS") ?? myLines[0] ?? null;

  if (session.role === "EMPLOYEE") {
    return NextResponse.json({ line: myLine, lines: myLines });
  }

  const branchWhere = session.role === "MANAGER" ? { branch: session.branch } : {};

  const employeesRaw: any = await prisma.user.findMany({
    where: { isActive: true, ...branchWhere },
    select: {
      id: true, name: true, department: true, position: true, branch: true,
      approvalLines: { include: stepInclude },
    },
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });

  // 각 직원: approvalLines(배열) + 하위호환용 approvalLine(연차 라인)
  const employees = employeesRaw.map((e: any) => ({
    ...e,
    approvalLine: e.approvalLines.find((l: any) => l.purpose === "LEAVE_2PLUS") ?? e.approvalLines[0] ?? null,
  }));

  const allUsers = await prisma.user.findMany({
    where: { isActive: true, ...branchWhere },
    select: { id: true, name: true, department: true, position: true, branch: true },
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ employees, allUsers, line: myLine, lines: myLines });
}
