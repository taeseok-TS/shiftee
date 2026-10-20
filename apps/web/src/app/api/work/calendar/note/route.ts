import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { NOTE_MAX, YM, noteScope } from "@/lib/work-calendar";

// 캘린더 오른쪽 「이달의 지점 공유」 메모(#222, 2026-10-20 권경욱 제안 · 디렉터 「처리하자」)
// 지점·달마다 하나. 원장(담당 지점)·관리자가 쓰고, 그 지점 구성원은 읽기만 한다.

// GET ?ym=2026-10&branch=대치 — branch 를 안 주면(또는 볼 수 없는 지점이면) 볼 수 있는 첫 지점
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const ym = searchParams.get("ym") || "";
  if (!YM.test(ym)) return NextResponse.json({ error: "달 형식이 올바르지 않습니다." }, { status: 400 });

  const { branches, canEdit } = await noteScope(session);
  const asked = searchParams.get("branch");
  const branch = asked && branches.includes(asked) ? asked : branches[0] ?? null;
  if (!branch) return NextResponse.json({ branches: [], branch: null, content: "", updatedAt: null, updatedByName: null, canEdit: false });

  const note = await prisma.workCalendarNote.findUnique({ where: { branch_ym: { branch, ym } } });
  return NextResponse.json({
    branches,
    branch,
    content: note?.content ?? "",
    updatedAt: note?.content ? note.updatedAt : null,
    updatedByName: note?.content ? note.updatedByName : null,
    canEdit,
  });
}

// PUT { ym, branch, content } — 원장은 담당 지점만, 관리자는 모든 지점
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const ym = typeof body?.ym === "string" ? body.ym : "";
  const branch = typeof body?.branch === "string" ? body.branch : "";
  const content = typeof body?.content === "string" ? body.content.replace(/\r\n/g, "\n").trim() : null;
  if (!YM.test(ym) || !branch || content === null) return NextResponse.json({ error: "입력값이 올바르지 않습니다." }, { status: 400 });
  if (content.length > NOTE_MAX) return NextResponse.json({ error: `${NOTE_MAX.toLocaleString()}자까지 쓸 수 있습니다.` }, { status: 400 });

  const { branches, canEdit } = await noteScope(session);
  if (!canEdit || !branches.includes(branch)) return NextResponse.json({ error: "이 지점 메모를 고칠 권한이 없습니다." }, { status: 403 });

  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
  const note = await prisma.workCalendarNote.upsert({
    where: { branch_ym: { branch, ym } },
    create: { branch, ym, content, updatedBy: session.userId, updatedByName: me?.name ?? null },
    update: { content, updatedBy: session.userId, updatedByName: me?.name ?? null },
  });
  return NextResponse.json({ success: true, content: note.content, updatedAt: note.content ? note.updatedAt : null, updatedByName: note.content ? note.updatedByName : null });
}
