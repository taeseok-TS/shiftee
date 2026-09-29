import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { EMOTICON_DIR, EMOTICON_URL_PREFIX } from "@/lib/emoticons";

// 세트 이름·켜기/끄기·순서 바꾸기
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });

  const { setId } = await params;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; isActive?: unknown; sortOrder?: unknown };
  const data: { name?: string; isActive?: boolean; sortOrder?: number } = {};
  if (typeof body.name === "string") {
    const n = body.name.trim().slice(0, 30);
    if (!n) return NextResponse.json({ error: "세트 이름을 입력해주세요." }, { status: 400 });
    data.name = n;
  }
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.sortOrder === "number" && Number.isInteger(body.sortOrder)) data.sortOrder = body.sortOrder;
  if (!Object.keys(data).length) return NextResponse.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });

  const found = await prisma.emoticonSet.findUnique({ where: { id: setId }, select: { name: true } });
  if (!found) return NextResponse.json({ error: "세트를 찾을 수 없습니다." }, { status: 404 });
  const set = await prisma.emoticonSet.update({ where: { id: setId }, data });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMOTICON_SET_UPDATE",
    targetType: "EMOTICON_SET", targetId: setId, targetName: set.name, detail: JSON.stringify(data),
  });
  return NextResponse.json({ set });
}

// 세트 삭제 — 한 번도 보낸 적 없는 세트만. 보낸 적 있으면 [숨기기](isActive=false)를 쓴다.
// (지우면 이미 보낸 메시지의 그림이 깨진다)
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });

  const { setId } = await params;
  const set = await prisma.emoticonSet.findUnique({
    where: { id: setId }, select: { name: true, items: { select: { url: true } } },
  });
  if (!set) return NextResponse.json({ error: "세트를 찾을 수 없습니다." }, { status: 404 });
  const urls = set.items.map((i) => i.url);
  const sent = urls.length ? await prisma.workMessage.count({ where: { fileType: "sticker", fileUrl: { in: urls } } }) : 0;
  if (sent) {
    return NextResponse.json(
      { error: `이미 ${sent}번 보낸 세트라 지울 수 없습니다. 숨기기를 쓰세요(보낸 메시지의 그림은 그대로 남습니다).` },
      { status: 409 },
    );
  }
  await prisma.emoticonSet.delete({ where: { id: setId } });
  // 그림 파일도 정리 — 이 폴더의 우리 파일만(경로 이탈 방지)
  for (const u of urls) {
    if (!u.startsWith(EMOTICON_URL_PREFIX)) continue;
    const file = path.basename(u);
    await fs.unlink(path.join(process.cwd(), "uploads", EMOTICON_DIR, file)).catch(() => {});
  }
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMOTICON_SET_DELETE",
    targetType: "EMOTICON_SET", targetId: setId, targetName: set.name, detail: `이모티콘 ${urls.length}개와 함께 삭제`,
  });
  return NextResponse.json({ success: true });
}
