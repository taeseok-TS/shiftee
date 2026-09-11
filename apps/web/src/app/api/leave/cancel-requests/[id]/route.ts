import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { ymdOf } from "@/lib/leave-cancel-flow";

/**
 * 취소 결재 **철회** — 올린 본인만, 대기 중일 때만. 휴가는 그대로 유지된다.
 * 결재자는 철회가 아니라 승인·반려로 처리한다(반려는 결재 결과로 기록에 남는다).
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;

  const cr = await prisma.leaveCancelRequest.findUnique({
    where: { id },
    include: {
      user: { select: { name: true } },
      leaveRequest: { select: { id: true, startDate: true, endDate: true } },
    },
  });
  if (!cr) return NextResponse.json({ error: "취소 요청을 찾을 수 없습니다." }, { status: 404 });
  if (cr.userId !== session.userId) {
    return NextResponse.json({ error: "본인이 올린 취소 요청만 철회할 수 있습니다." }, { status: 403 });
  }
  if (cr.status !== "PENDING") {
    return NextResponse.json({ error: "이미 처리된 취소 요청입니다." }, { status: 409 });
  }

  let done = false;
  await prisma.$transaction(async (tx) => {
    // 먼저 잡는 쪽만 — 결재자가 같은 순간 승인해도 둘 중 하나만 성립한다
    const claimed = await tx.leaveCancelRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (claimed.count === 0) return;
    done = true;
    // 남은 결재 단계도 닫는다 — 안 닫으면 철회된 요청이 결재함에 계속 뜬다
    await tx.leaveCancelStep.updateMany({
      where: { cancelRequestId: id, status: { in: ["PENDING", "WAITING"] } },
      data: { status: "REJECTED", comment: "요청 철회", decidedAt: new Date() },
    });
  });
  if (!done) return NextResponse.json({ error: "이미 처리된 취소 요청입니다." }, { status: 409 });

  await logAudit({
    actorId: session.userId, actorName: session.name, action: "LEAVE_CANCEL_WITHDRAW",
    targetType: "LEAVE", targetId: cr.leaveRequest.id, targetName: cr.user?.name ?? null,
    detail: `휴가 취소 요청 철회 (${ymdOf(cr.leaveRequest.startDate)} ~ ${ymdOf(cr.leaveRequest.endDate)})`,
  });
  return NextResponse.json({ success: true });
}
