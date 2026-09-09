import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

/**
 * DELETE /api/schedule-requests/[id] — 본인이 낸 근무일정 신청을 취소한다.
 *
 * 종전에는 취소 수단이 아예 없었다(`CANCELLED` 는 enum 에만 있고 쓰는 코드가 0곳).
 * 잘못 낸 신청을 없애려면 결재자가 "반려"해주는 수밖에 없었는데, 그러면 기록에
 * 반려로 남아 나중에 사유를 오해하게 된다(2026-09-08 검증에서 적발).
 *
 * 아직 결재가 시작되지 않은 것(PENDING)만 취소할 수 있다. 이미 승인.반려된 것은
 * 손대지 않는다 — 승인된 신청은 이미 근무일정으로 반영돼 있다.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const req = await prisma.scheduleRequest.findUnique({
    where: { id },
    select: { id: true, userId: true, status: true, startDate: true, endDate: true },
  });
  if (!req) return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });

  // 남의 신청은 건드릴 수 없다 — 결재자도 마찬가지다(그건 반려로 처리한다).
  if (req.userId !== session.userId) {
    return NextResponse.json({ error: "본인이 낸 신청만 취소할 수 있습니다." }, { status: 403 });
  }
  if (req.status !== "PENDING") {
    return NextResponse.json(
      { error: `이미 ${req.status === "APPROVED" ? "승인" : "처리"}된 신청은 취소할 수 없습니다.` },
      { status: 409 }
    );
  }

  await prisma.$transaction(async (tx) => {
    await tx.scheduleRequest.update({ where: { id }, data: { status: "CANCELLED" } });
    // 남아 있는 결재 단계도 함께 닫는다. 안 닫으면 취소된 신청이 결재함에 계속 뜬다.
    await tx.scheduleApprovalStep.updateMany({
      where: { scheduleRequestId: id, status: { in: ["PENDING", "WAITING"] } },
      data: { status: "REJECTED", comment: "신청자 취소", decidedAt: new Date() },
    });
  });

  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "SCHEDULE_CANCEL",
    targetType: "SCHEDULE", targetId: id, targetName: session.name,
    detail: `근무일정 신청 취소 (${ymd(req.startDate)} ~ ${ymd(req.endDate)})`,
  });

  return NextResponse.json({ success: true, message: "신청을 취소했습니다." });
}
