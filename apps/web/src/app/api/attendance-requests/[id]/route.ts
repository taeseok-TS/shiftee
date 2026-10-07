import { NextRequest, NextResponse } from "next/server";
import { getSession, bumpTokenVersion } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { approverScopeFor } from "@/lib/approval-delegate";
import { KIND_LABEL, RequestConflict, applyApproved, canDecide, summaryOf, type RequestKind } from "@/lib/attendance-request";

export const dynamic = "force-dynamic";

// 출퇴근 요청 처리 — POST { action: "approve" | "reject", reason? } / 본인 취소 DELETE
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown; reason?: unknown } | null;
  if (body?.action !== "approve" && body?.action !== "reject")
    return NextResponse.json({ error: "요청이 올바르지 않습니다. (approve 또는 reject)" }, { status: 400 });
  if (body.reason != null && typeof body.reason !== "string")
    return NextResponse.json({ error: "사유 형식이 올바르지 않습니다." }, { status: 400 });
  const approve = body.action === "approve";
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 300) : null;

  const r = await prisma.attendanceRequest.findUnique({ where: { id }, include: { user: { select: { name: true, role: true } } } });
  if (!r) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
  if (r.status !== "PENDING") return NextResponse.json({ error: "이미 처리된 요청입니다." }, { status: 409 });
  if (r.userId === session.userId) return NextResponse.json({ error: "본인 요청은 직접 처리할 수 없습니다." }, { status: 403 });
  const scope = await approverScopeFor(session);
  if (!canDecide(r, session, scope, r.user.role)) return NextResponse.json({ error: "처리 권한이 없습니다." }, { status: 403 });

  let deviceChanged = false;
  try {
    await prisma.$transaction(async (tx) => {
      // 먼저 잡는다 — 두 사람이 동시에 눌러도 한 번만 반영
      const claimed = await tx.attendanceRequest.updateMany({
        where: { id, status: "PENDING" },
        data: { status: approve ? "APPROVED" : "REJECTED", decidedBy: session.userId, decidedAt: new Date(), rejectReason: approve ? null : reason },
      });
      if (claimed.count === 0) throw new RequestConflict("이미 처리된 요청입니다.");
      if (approve) deviceChanged = !!(await applyApproved(tx, r, session.role)).deviceChanged;
    });
  } catch (e) {
    if (e instanceof RequestConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    // 같은 사람·같은 날 기록이 동시에 만들어지면(출근 버튼과 승인이 겹침) — 되돌려졌으니 다시 누르면 된다
    if ((e as { code?: string })?.code === "P2002")
      return NextResponse.json({ error: "같은 날 기록이 방금 바뀌었습니다. 다시 눌러 주세요." }, { status: 409 });
    throw e;
  }
  // 기기를 바꿨으면 옛 기기에 남은 세션을 끊는다(기기 초기화와 같은 처리)
  if (deviceChanged) await bumpTokenVersion(r.userId).catch(() => {});

  const label = KIND_LABEL[r.kind as RequestKind] ?? r.kind;
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "ATTENDANCE_REQUEST_DECISION",
    targetType: "AttendanceRequest", targetId: r.id, targetName: r.user.name,
    detail: `${label} ${approve ? "승인" : "반려"}: ${r.user.name} · ${summaryOf(r)}${!approve && reason ? ` · 사유: ${reason}` : ""}`,
  });
  const { botNotifyDecision } = await import("@/lib/bot");
  botNotifyDecision(r.userId, `${label} (${summaryOf(r)})`, approve, session.name, reason,
    { actorId: session.userId, actorRole: session.role }).catch(() => {});
  return NextResponse.json({ success: true });
}

// 본인이 대기 중인 요청을 거둔다
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const claimed = await prisma.attendanceRequest.updateMany({
    where: { id, userId: session.userId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
  if (claimed.count === 0) return NextResponse.json({ error: "취소할 수 있는 요청이 없습니다." }, { status: 409 });
  const r = await prisma.attendanceRequest.findUnique({ where: { id } });
  if (r) {
    const { botNotifyAdminsProgress } = await import("@/lib/bot");
    botNotifyAdminsProgress(`${session.name} · ${KIND_LABEL[r.kind as RequestKind] ?? r.kind} 요청 취소 (${summaryOf(r)})`, [session.userId]).catch(() => {});
  }
  return NextResponse.json({ success: true });
}
