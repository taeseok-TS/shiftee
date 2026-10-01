import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertMessageAccess } from "@/lib/work-access";
import { emitWork } from "@/lib/work-events";

// 메시지 삭제(되돌리기) — 본인 메시지만. 소프트 삭제로 "삭제된 메시지" 표시.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const m = await prisma.workMessage.findUnique({ where: { id }, select: { userId: true, channelId: true } });
  if (!m) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  // 지금 그 방 사람이어야 한다 — 방에서 나간(내보내진) 뒤에 옛 메시지를 지우며 그 방에 신호를 내지 못하게(2026-10-01)
  const accDel = await assertMessageAccess(id, session.userId);
  if (!accDel.ok) return NextResponse.json({ error: accDel.error }, { status: accDel.status });
  if (m.userId !== session.userId)
    return NextResponse.json({ error: "본인 메시지만 삭제할 수 있습니다." }, { status: 403 });

  await prisma.workMessage.update({ where: { id }, data: { deletedAt: new Date() } });
  emitWork({ type: "message", channelId: m.channelId });
  return NextResponse.json({ ok: true });
}

// 메시지 수정 — 본인 메시지만. content 변경 + editedAt 표시.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { content } = await request.json();
  if (!content?.trim()) return NextResponse.json({ error: "내용을 입력해주세요." }, { status: 400 });

  const m = await prisma.workMessage.findUnique({ where: { id }, select: { userId: true, channelId: true, deletedAt: true, fileType: true } });
  if (!m) return NextResponse.json({ error: "메시지를 찾을 수 없습니다." }, { status: 404 });
  // 지금 그 방 사람이어야 한다 — 내보내진 뒤에 옛 메시지를 고쳐 그 방에 새 글을 넣는 길이었다(2026-10-01 검증관 P2)
  const accEdit = await assertMessageAccess(id, session.userId);
  if (!accEdit.ok) return NextResponse.json({ error: accEdit.error }, { status: accEdit.status });
  if (m.userId !== session.userId)
    return NextResponse.json({ error: "본인 메시지만 수정할 수 있습니다." }, { status: 403 });
  if (m.deletedAt) return NextResponse.json({ error: "삭제된 메시지는 수정할 수 없습니다." }, { status: 400 });
  if (m.fileType === "sticker") return NextResponse.json({ error: "이모티콘은 수정할 수 없습니다." }, { status: 400 });

  await prisma.workMessage.update({ where: { id }, data: { content: content.trim(), editedAt: new Date() } });
  emitWork({ type: "message", channelId: m.channelId });
  return NextResponse.json({ ok: true });
}
