import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { EMOTICON_DIR, EMOTICON_URL_PREFIX } from "@/lib/emoticons";

// 이모티콘 하나 — 이름·켜기/끄기·순서
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });

  const { itemId } = await params;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; isActive?: unknown; sortOrder?: unknown };
  const data: { name?: string; isActive?: boolean; sortOrder?: number } = {};
  if (typeof body.name === "string") {
    const n = body.name.trim().slice(0, 30);
    if (!n) return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
    data.name = n;
  }
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)) data.sortOrder = body.sortOrder;
  if (!Object.keys(data).length) return NextResponse.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });

  const found = await prisma.emoticon.findUnique({ where: { id: itemId }, select: { id: true } });
  if (!found) return NextResponse.json({ error: "이모티콘을 찾을 수 없습니다." }, { status: 404 });
  const item = await prisma.emoticon.update({ where: { id: itemId }, data });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMOTICON_UPDATE",
    targetType: "EMOTICON", targetId: itemId, targetName: item.name, detail: JSON.stringify(data),
  });
  return NextResponse.json({ item });
}

// 삭제 — 한 번도 보낸 적 없을 때만(보낸 메시지의 그림이 깨지지 않게). 아니면 숨기기.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ itemId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });

  const { itemId } = await params;
  const item = await prisma.emoticon.findUnique({ where: { id: itemId }, select: { name: true, url: true } });
  if (!item) return NextResponse.json({ error: "이모티콘을 찾을 수 없습니다." }, { status: 404 });
  const sent = await prisma.workMessage.count({ where: { fileType: "sticker", fileUrl: item.url } });
  if (sent) {
    return NextResponse.json(
      { error: `이미 ${sent}번 보낸 이모티콘이라 지울 수 없습니다. 숨기기를 쓰세요.` },
      { status: 409 },
    );
  }
  await prisma.emoticon.delete({ where: { id: itemId } });
  if (item.url.startsWith(EMOTICON_URL_PREFIX)) {
    await fs.unlink(path.join(process.cwd(), "uploads", EMOTICON_DIR, path.basename(item.url))).catch(() => {});
  }
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMOTICON_DELETE",
    targetType: "EMOTICON", targetId: itemId, targetName: item.name, detail: "이모티콘 삭제",
  });
  return NextResponse.json({ success: true });
}
