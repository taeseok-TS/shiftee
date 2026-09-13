import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// 본부 — 남의 키 끄기
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 끌 수 있습니다." }, { status: 403 });
  const { id } = await params;
  const key = await prisma.apiKey.findUnique({ where: { id } });
  if (!key) return NextResponse.json({ error: "키를 찾을 수 없습니다." }, { status: 404 });
  if (!key.revokedAt) {
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date(), revokedBy: session.userId } });
    await logAudit({ actorId: session.userId, actorName: session.name, action: "API_KEY_REVOKE", targetType: "API_KEY", targetId: id, targetName: key.name, detail: "본부가 끔" });
    const { botSendDM } = await import("@/lib/bot");
    void botSendDM(key.userId, `🔑 본부가 API 키 「${key.name}」(${key.prefix}…)을 껐습니다. 필요하면 본부에 문의해주세요.`);
  }
  return NextResponse.json({ success: true });
}
