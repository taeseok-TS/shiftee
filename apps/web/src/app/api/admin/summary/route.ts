import { NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 메인 관리자용: 관리자 계정 현황 + 변경(감사) 로그
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (!(await isSuperAdmin(session.userId)))
    return NextResponse.json({ error: "메인 관리자만 접근 가능합니다." }, { status: 403 });

  const [admins, logs] = await Promise.all([
    prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true, name: true, email: true, isSuperAdmin: true, createdAt: true },
      orderBy: [{ isSuperAdmin: "desc" }, { createdAt: "asc" }],
    }),
    prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
  ]);

  return NextResponse.json({ admins, logs });
}
