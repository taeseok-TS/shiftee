import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { pickTargetUsers } from "@/lib/submission-server";

export const dynamic = "force-dynamic";

// 받는 사람 묶음 — 본부 공용. 목록은 재직자만 남겨서 준다(퇴사자는 자동으로 빠짐).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부 관리자만 볼 수 있습니다." }, { status: 403 });
  const rows = await prisma.submissionTargetGroup.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ groups: rows.map((g) => ({ id: g.id, name: g.name, userIds: g.userIds, createdByName: g.createdByName, updatedAt: g.updatedAt })) });
}

// 묶음 저장 — 같은 이름이 있으면 덮어쓴다(화면에서 확인창을 거친다)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부 관리자만 묶음을 만들 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!name) return NextResponse.json({ error: "묶음 이름을 입력해주세요." }, { status: 400 });
  const picked = await pickTargetUsers(body.userIds);
  if (!picked || !picked.ids.length) return NextResponse.json({ error: "받는 사람이 올바르지 않습니다(퇴사자·본부는 넣을 수 없습니다)." }, { status: 400 });
  const existed = await prisma.submissionTargetGroup.findUnique({ where: { name }, select: { id: true } });
  const row = await prisma.submissionTargetGroup.upsert({
    where: { name },
    create: { name, userIds: picked.ids, createdBy: session.userId, createdByName: session.name },
    update: { userIds: picked.ids },
  });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: existed ? "SUBMISSION_TARGET_GROUP_UPDATE" : "SUBMISSION_TARGET_GROUP_CREATE",
    targetType: "SUBMISSION_TARGET_GROUP", targetId: row.id, targetName: name,
    detail: `${picked.ids.length}명 · ${picked.users.map((u) => `${u.branch ?? "-"} ${u.name}`).slice(0, 30).join(", ")}${picked.ids.length > 30 ? " …" : ""}`,
  });
  return NextResponse.json({ group: { id: row.id, name: row.name, userIds: row.userIds, createdByName: row.createdByName, updatedAt: row.updatedAt }, replaced: !!existed });
}
