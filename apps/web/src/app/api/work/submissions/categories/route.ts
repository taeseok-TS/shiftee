import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { CATEGORY_GROUPS, pickGroup } from "@/lib/submission-server";

// 자료제출 분류 — 교육 7종 + 본부 프로모션·이벤트. 본부가 화면에서 늘리고 이름을 바꾸고 숨긴다.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const rows = await prisma.submissionCategory.findMany({
    // 숨긴 분류는 본부만 본다(관리 화면에서 되살릴 수 있게)
    where: session.role === "ADMIN" ? {} : { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  return NextResponse.json({ categories: rows });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부 관리자만 분류를 추가할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const group = pickGroup(body.group);
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!group || !name) return NextResponse.json({ error: `구분(${CATEGORY_GROUPS.join("/")})과 이름을 입력해주세요.` }, { status: 400 });
  const dup = await prisma.submissionCategory.findUnique({ where: { group_name: { group, name } } });
  if (dup) return NextResponse.json({ error: "같은 이름의 분류가 이미 있습니다." }, { status: 409 });
  const last = await prisma.submissionCategory.findFirst({ where: { group }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const row = await prisma.submissionCategory.create({ data: { group, name, sortOrder: (last?.sortOrder ?? 0) + 10 } });
  await logAudit({ actorId: session.userId, actorName: session.name, action: "SUBMISSION_CATEGORY_CREATE", targetType: "SUBMISSION_CATEGORY", targetId: row.id, targetName: name, detail: `구분 ${group}` });
  return NextResponse.json({ category: row });
}
