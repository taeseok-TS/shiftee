import { NextRequest, NextResponse } from "next/server";
import { scheduleCancelDenial } from "@/lib/leave-cancel";
import { cancelViewerFor } from "@/lib/cancel-viewer";
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
    select: {
      id: true, userId: true, status: true, startDate: true, endDate: true,
      user: { select: { name: true, role: true, branch: true } },   // 감사로그 이름 + 범위 판정
    },
  });
  if (!req) return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });

  // 누가 무엇을 취소할 수 있는지는 lib/leave-cancel.ts **한 곳에서만** 정한다(휴가와 같은 범위 규칙).
  // 범위: 원장은 담당 지점 직원, 다른 원장의 건은 **그 지점 메인 원장이 일반 원장 건만**
  // (2026-09-10 디렉터 확정). 상태: 대기 중만 — 승인된 신청은 이미 일정으로 반영돼 있다.
  // 결재함 API 가 같은 함수로 canCancel 을 내려주고 화면은 그 값으로만 버튼을 그린다.
  const denial = scheduleCancelDenial(await cancelViewerFor(session), req);
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status });

  let done = false;
  await prisma.$transaction(async (tx) => {
    // 먼저 잡는 쪽만 처리한다(휴가 취소와 같은 방식)
    const claimed = await tx.scheduleRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    if (claimed.count === 0) return;
    done = true;
    // 남아 있는 결재 단계도 함께 닫는다. 안 닫으면 취소된 신청이 결재함에 계속 뜬다.
    await tx.scheduleApprovalStep.updateMany({
      where: { scheduleRequestId: id, status: { in: ["PENDING", "WAITING"] } },
      data: { status: "REJECTED", comment: "신청 취소", decidedAt: new Date() },
    });
  });

  if (!done) {
    return NextResponse.json({ error: "이미 처리된 신청입니다." }, { status: 409 });
  }

  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "SCHEDULE_CANCEL",
    targetType: "SCHEDULE", targetId: id, targetName: req.user?.name ?? null,
    detail: `근무일정 신청 취소 (${ymd(req.startDate)} ~ ${ymd(req.endDate)})`,
  });

  // 남의 신청을 취소했으면 당사자에게 알린다 — 모르는 사이에 사라지면 안 된다(휴가와 같게).
  if (req.userId !== session.userId) {
    const { botSendDM } = await import("@/lib/bot");
    botSendDM(
      req.userId,
      `근무일정 신청이 취소되었습니다.

기간: ${ymd(req.startDate)} ~ ${ymd(req.endDate)}
처리: ${session.name}`
    ).catch(() => {});
  }

  return NextResponse.json({ success: true, message: "신청을 취소했습니다." });
}
