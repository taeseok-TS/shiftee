import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { YM, noteScope } from "@/lib/work-calendar";

// 「이달의 지점 공유」 글 순서 바꾸기(#240, 2026-11-04 권경욱 제안 · 디렉터 「바꾸는 기능 만들어」) — 웹은 끌어서, 앱은 ▲▼.
// 바꾸는 사람 = 원장(담당 지점)·관리자 — 고정과 같은 권한. 화면에 보이는 순서 그대로 그 지점·달의 **모든 글 id** 를 받는다.
// 고정 글은 GET 이 늘 먼저 보여 주므로, 고정 글끼리 · 나머지끼리의 순서가 된다. 그 사이 글이 늘거나 지워졌으면 409(새로고침).
// PUT { ym, branch, ids: string[] }
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const ym = typeof body?.ym === "string" ? body.ym : "";
  const branch = typeof body?.branch === "string" ? body.branch : "";
  const ids: unknown = body?.ids;
  if (!YM.test(ym) || !branch || !Array.isArray(ids) || !ids.every((x) => typeof x === "string"))
    return NextResponse.json({ error: "입력값이 올바르지 않습니다." }, { status: 400 });

  const { branches, canManage } = await noteScope(session);
  if (!canManage || !branches.includes(branch)) return NextResponse.json({ error: "순서는 원장·관리자만 바꿀 수 있습니다." }, { status: 403 });

  const order = ids as string[];
  const rows = await prisma.workCalendarPost.findMany({ where: { branch, ym }, select: { id: true } });
  const have = new Set(rows.map((r) => r.id));
  if (new Set(order).size !== order.length || order.length !== have.size || !order.every((id) => have.has(id)))
    return NextResponse.json({ error: "그 사이 글이 바뀌었습니다. 새로고침한 뒤 다시 옮겨 주세요." }, { status: 409 });

  // 확인과 저장 사이에 글이 지워지면 update 가 P2025 — 트랜잭션은 통째로 되돌아가니 같은 409 안내로(검증 3)
  try {
    await prisma.$transaction(order.map((id, i) => prisma.workCalendarPost.update({ where: { id }, data: { sortOrder: i } })));
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") return NextResponse.json({ error: "그 사이 글이 바뀌었습니다. 새로고침한 뒤 다시 옮겨 주세요." }, { status: 409 });
    throw e;
  }
  return NextResponse.json({ success: true });
}
