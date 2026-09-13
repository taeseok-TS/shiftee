import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// 본부 — 직원의 API 키 발급 허용 켜기/끄기 (승인 ⑤: 관리자가 켜 준 사람만). 끄면 그 사람의 키가 즉시 안 통한다.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 바꿀 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const userId = typeof body.userId === "string" ? body.userId : "";
  const allowed = body.allowed === true;
  const u = userId ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, isActive: true, deletedAt: true } }) : null;
  if (!u || u.deletedAt) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  await prisma.user.update({ where: { id: u.id }, data: { apiKeysAllowed: allowed } });
  await logAudit({ actorId: session.userId, actorName: session.name, action: "API_KEY_ALLOW", targetType: "USER", targetId: u.id, targetName: u.name, detail: allowed ? "API 키 발급 허용" : "API 키 발급 해제" });
  return NextResponse.json({ success: true, userId: u.id, allowed });
}
