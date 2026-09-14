import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// 묶음 지우기 (본부만). 이미 걸린 요청에는 영향 없다 — 요청은 사람 id 를 따로 들고 있다.
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부 관리자만 지울 수 있습니다." }, { status: 403 });
  const { id } = await params;
  const g = await prisma.submissionTargetGroup.findUnique({ where: { id } });
  if (!g) return NextResponse.json({ error: "묶음을 찾을 수 없습니다." }, { status: 404 });
  await prisma.submissionTargetGroup.delete({ where: { id } });
  await logAudit({ actorId: session.userId, actorName: session.name, action: "SUBMISSION_TARGET_GROUP_DELETE", targetType: "SUBMISSION_TARGET_GROUP", targetId: id, targetName: g.name, detail: `${g.userIds.length}명` });
  return NextResponse.json({ ok: true });
}
