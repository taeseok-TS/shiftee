import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const contract = await prisma.contract.findUnique({ where: { id } });

  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  if (contract.userId !== session.userId && session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  const updated = await prisma.contract.update({
    where: { id },
    data: { status: "SIGNED", signedAt: new Date() },
  });

  return NextResponse.json({ success: true, contract: updated });
}
