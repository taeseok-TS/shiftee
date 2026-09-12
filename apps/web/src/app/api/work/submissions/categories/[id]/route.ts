import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// 분류 이름 변경·숨김·순서 (본부만). 삭제는 없다 — 제출물이 매달려 있어 숨김으로 대신한다.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부 관리자만 분류를 바꿀 수 있습니다." }, { status: 403 });
  const { id } = await params;
  const cur = await prisma.submissionCategory.findUnique({ where: { id } });
  if (!cur) return NextResponse.json({ error: "분류를 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const data: { name?: string; active?: boolean; sortOrder?: number } = {};
  if (typeof body.name === "string") {
    const name = body.name.trim().slice(0, 40);
    if (!name) return NextResponse.json({ error: "이름을 입력해주세요." }, { status: 400 });
    if (name !== cur.name) {
      const dup = await prisma.submissionCategory.findUnique({ where: { group_name: { group: cur.group, name } } });
      if (dup) return NextResponse.json({ error: "같은 이름의 분류가 이미 있습니다." }, { status: 409 });
    }
    data.name = name;
  }
  if (typeof body.active === "boolean") data.active = body.active;
  if (typeof body.sortOrder === "number" && Number.isFinite(body.sortOrder)) data.sortOrder = Math.floor(body.sortOrder);
  if (!Object.keys(data).length) return NextResponse.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });
  const row = await prisma.submissionCategory.update({ where: { id }, data });
  const what = [data.name !== undefined && `이름 ${cur.name}→${data.name}`, data.active !== undefined && (data.active ? "표시" : "숨김"), data.sortOrder !== undefined && `순서 ${data.sortOrder}`].filter(Boolean).join(", ");
  await logAudit({ actorId: session.userId, actorName: session.name, action: "SUBMISSION_CATEGORY_UPDATE", targetType: "SUBMISSION_CATEGORY", targetId: id, targetName: row.name, detail: what });
  return NextResponse.json({ category: row });
}
