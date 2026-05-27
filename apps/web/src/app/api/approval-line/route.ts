import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 전체 직원 + 결재라인 조회 (관리자)
export async function GET() {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const branchWhere = session.role === "MANAGER" ? { branch: session.branch } : {};

  const employees: any = await (prisma.user as any).findMany({
    where: { isActive: true, ...branchWhere },
    select: {
      id: true,
      name: true,
      department: true,
      position: true,
      branch: true,
      approvalLine: {
        include: {
          steps: {
            include: {
              approver: { select: { id: true, name: true, position: true, department: true, branch: true } },
            },
            orderBy: { order: "asc" },
          },
        },
      },
    },
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });

  // 결재자로 쓸 수 있는 직원 목록 (MANAGER는 자기 지점 내)
  const allUsers = await prisma.user.findMany({
    where: { isActive: true, ...branchWhere },
    select: { id: true, name: true, department: true, position: true, branch: true },
    orderBy: [{ department: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ employees, allUsers });
}
