import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// [미제출자 독촉] — 본부 버튼. 그 사람들에게만 봇 DM.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부 관리자만 독촉할 수 있습니다." }, { status: 403 });
  const { id } = await params;
  const r = await prisma.submissionRequest.findUnique({ where: { id }, select: { id: true, title: true, closedAt: true } });
  if (!r) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
  if (r.closedAt) return NextResponse.json({ error: "닫힌 요청입니다. 다시 열고 독촉해주세요." }, { status: 400 });
  const { remindRequest } = await import("@/lib/submission-notify");
  const n = await remindRequest(id, "manual");
  await logAudit({ actorId: session.userId, actorName: session.name, action: "SUBMISSION_REQUEST_REMIND", targetType: "SUBMISSION_REQUEST", targetId: id, targetName: r.title, detail: `미제출자 ${n}명에게 독촉` });
  return NextResponse.json({ sent: n });
}
