import { NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hiddenWhere } from "@/lib/hidden-accounts";

// 메인 관리자용: 관리자 계정 현황 + 로그인 실패. 변경(감사) 로그는 /api/admin/audit(2026-10-14 #66 후속)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (!(await isSuperAdmin(session.userId)))
    return NextResponse.json({ error: "메인 관리자만 접근 가능합니다." }, { status: 403 });

  // 개발자 영역(메인 관리자)은 보는 사람에게만 — 숨김 계정 본인은 자기 행은 본다(lib/hidden-accounts, 2026-10-17 디렉터)
  const hideWhere = await hiddenWhere(session);
  const [admins, loginFails] = await Promise.all([
    prisma.user.findMany({
      where: { role: "ADMIN", isActive: true, ...hideWhere },
      select: { id: true, name: true, email: true, phone: true, isSuperAdmin: true, createdAt: true, hireDate: true, birthDate: true, position: true, jobGroup: true, isContractApprover: true, canViewSalary: true },
      orderBy: [{ isSuperAdmin: "desc" }, { createdAt: "asc" }],
    }),
    prisma.loginFailLog.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  return NextResponse.json({ admins, loginFails });
}
