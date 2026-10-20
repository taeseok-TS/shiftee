import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { POST_MAX, noteScope, postView } from "@/lib/work-calendar";

// 「이달의 지점 공유」 글 한 건 고치기·고정·지우기(2026-10-20).
// 고치기·지우기 = 쓴 사람(지금도 쓸 권한이 있을 때) 또는 그 지점 원장·관리자. 고정 = 원장·관리자만.
async function load(id: string, session: { userId: string; role: string }) {
  const post = await prisma.workCalendarPost.findUnique({ where: { id } });
  if (!post) return { error: NextResponse.json({ error: "글을 찾을 수 없습니다." }, { status: 404 }) };
  const { branches, canEdit, canManage } = await noteScope(session);
  if (!branches.includes(post.branch)) return { error: NextResponse.json({ error: "글을 찾을 수 없습니다." }, { status: 404 }) }; // 다른 지점 글은 있는지도 알리지 않는다
  return { post, canEdit, canManage };
}

// PATCH { content?, pinned? }
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const r = await load(id, session);
  if ("error" in r) return r.error;
  const { post, canEdit, canManage } = r;

  const body = await request.json().catch(() => null);
  const data: { content?: string; pinned?: boolean; editedAt?: Date } = {};
  if (body?.content !== undefined) {
    if (!(canManage || (canEdit && post.authorId === session.userId)))
      return NextResponse.json({ error: "이 글을 고칠 권한이 없습니다." }, { status: 403 });
    const content = typeof body.content === "string" ? body.content.replace(/\r\n/g, "\n").trim() : "";
    if (!content) return NextResponse.json({ error: "내용을 입력해 주세요." }, { status: 400 });
    if (content.length > POST_MAX) return NextResponse.json({ error: `한 건에 ${POST_MAX.toLocaleString()}자까지 쓸 수 있습니다.` }, { status: 400 });
    if (content !== post.content) { data.content = content; data.editedAt = new Date(); }
    else data.content = content; // 그대로면 「(수정됨)」을 붙이지 않는다
  }
  if (body?.pinned !== undefined) {
    if (!canManage) return NextResponse.json({ error: "고정은 원장·관리자만 할 수 있습니다." }, { status: 403 });
    if (typeof body.pinned !== "boolean") return NextResponse.json({ error: "입력값이 올바르지 않습니다." }, { status: 400 });
    data.pinned = body.pinned;
  }
  if (data.content === undefined && data.pinned === undefined) return NextResponse.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });

  const updated = await prisma.workCalendarPost.update({ where: { id }, data });
  return NextResponse.json({ success: true, post: postView(updated, session.userId, canEdit, canManage) });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const r = await load(id, session);
  if ("error" in r) return r.error;
  const { post, canEdit, canManage } = r;
  if (!(canManage || (canEdit && post.authorId === session.userId)))
    return NextResponse.json({ error: "이 글을 지울 권한이 없습니다." }, { status: 403 });
  await prisma.workCalendarPost.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
