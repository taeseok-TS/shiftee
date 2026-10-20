import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { POST_MAX, POSTS_PER_MONTH_MAX, YM, noteScope, postView } from "@/lib/work-calendar";

// 캘린더 오른쪽 「이달의 지점 공유」(#222, 2026-10-20 권경욱 제안) — 글이 한 건씩 쌓인다(디렉터 「쌓이는 방식으로」).
// 지점·달별로 모인다. 쓰기 = 관리자·원장(담당 지점)·원장이 지정한 직원, 보기 = 그 지점 구성원(다른 지점엔 안 보임).

// GET ?ym=2026-10&branch=대치 — branch 를 안 주면(또는 볼 수 없는 지점이면) 볼 수 있는 첫 지점.
// 글 순서: 고정 글 먼저, 그다음 최신 글이 위
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ym = searchParams.get("ym") || "";
  if (!YM.test(ym)) return NextResponse.json({ error: "달 형식이 올바르지 않습니다." }, { status: 400 });

  const { branches, canEdit, canManage } = await noteScope(session);
  const asked = searchParams.get("branch");
  const branch = asked && branches.includes(asked) ? asked : branches[0] ?? null;
  if (!branch) return NextResponse.json({ branches: [], branch: null, posts: [], canEdit: false, canManage: false });

  const posts = await prisma.workCalendarPost.findMany({
    where: { branch, ym },
    orderBy: [{ pinned: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({
    branches,
    branch,
    posts: posts.map((p) => postView(p, session.userId, canEdit, canManage)),
    canEdit, // 「올리기」 단추
    canManage, // 작성자 지정·고정(원장·관리자)
  });
}

// POST { ym, branch, content } — 한 건 올리기
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const ym = typeof body?.ym === "string" ? body.ym : "";
  const branch = typeof body?.branch === "string" ? body.branch : "";
  const content = typeof body?.content === "string" ? body.content.replace(/\r\n/g, "\n").trim() : "";
  if (!YM.test(ym) || !branch) return NextResponse.json({ error: "입력값이 올바르지 않습니다." }, { status: 400 });
  if (!content) return NextResponse.json({ error: "내용을 입력해 주세요." }, { status: 400 });
  if (content.length > POST_MAX) return NextResponse.json({ error: `한 건에 ${POST_MAX.toLocaleString()}자까지 쓸 수 있습니다.` }, { status: 400 });

  const { branches, canEdit, canManage } = await noteScope(session);
  if (!canEdit || !branches.includes(branch)) return NextResponse.json({ error: "이 지점에 올릴 권한이 없습니다." }, { status: 403 });
  if ((await prisma.workCalendarPost.count({ where: { branch, ym } })) >= POSTS_PER_MONTH_MAX)
    return NextResponse.json({ error: `한 달에 ${POSTS_PER_MONTH_MAX}건까지 올릴 수 있습니다.` }, { status: 400 });

  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
  const post = await prisma.workCalendarPost.create({
    data: { branch, ym, content, authorId: session.userId, authorName: me?.name ?? null },
  });
  return NextResponse.json({ success: true, post: postView(post, session.userId, canEdit, canManage) });
}
