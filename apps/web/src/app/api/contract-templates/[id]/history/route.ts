import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 템플릿 수정 기록(#22 「누가·언제·무엇을 고쳤는지」) — 감사 기록 중 이 템플릿 것만, 최신순 50건.
// 편집기 오른쪽 「수정 기록」과 템플릿 수정 창이 본다. 관리자·원장.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const { id } = await params;
  const rows = await prisma.auditLog.findMany({
    where: { targetType: "ContractTemplate", targetId: id },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, actorName: true, detail: true, createdAt: true },
  });
  return NextResponse.json({ items: rows.map((r) => ({ id: r.id, at: r.createdAt, by: r.actorName, detail: r.detail || "" })) });
}
