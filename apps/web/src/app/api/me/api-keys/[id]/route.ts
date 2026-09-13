import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { publicKey, resetApiKeyBucket } from "@/lib/api-key";

export const dynamic = "force-dynamic";

// 내 키 끄기(되돌릴 수 없음)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const key = await prisma.apiKey.findFirst({ where: { id, userId: session.userId } });
  if (!key) return NextResponse.json({ error: "키를 찾을 수 없습니다." }, { status: 404 });
  if (!key.revokedAt) {
    await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date(), revokedBy: session.userId } });
    await logAudit({ actorId: session.userId, actorName: session.name, action: "API_KEY_REVOKE", targetType: "API_KEY", targetId: id, targetName: key.name, detail: "본인이 끔" });
  }
  return NextResponse.json({ success: true });
}

// 이상 감지로 멈춘 키를 본인이 다시 켠다
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const key = await prisma.apiKey.findFirst({ where: { id, userId: session.userId } });
  if (!key) return NextResponse.json({ error: "키를 찾을 수 없습니다." }, { status: 404 });
  if (body.resume !== true) return NextResponse.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });
  if (key.revokedAt) return NextResponse.json({ error: "꺼진 키는 다시 켤 수 없습니다. 새로 만들어주세요." }, { status: 400 });
  if (!key.suspendedAt) return NextResponse.json({ error: "멈춘 키가 아닙니다." }, { status: 400 });
  const row = await prisma.apiKey.update({ where: { id }, data: { suspendedAt: null, suspendReason: null } });
  resetApiKeyBucket(id); // 집계를 비워야 첫 요청에서 바로 다시 멈추지 않는다
  await logAudit({ actorId: session.userId, actorName: session.name, action: "API_KEY_RESUME", targetType: "API_KEY", targetId: id, targetName: key.name, detail: `멈춤 해제 (${key.suspendReason ?? ""})` });
  return NextResponse.json({ key: publicKey(row) });
}
