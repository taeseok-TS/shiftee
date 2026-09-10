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
    select: {
      id: true, userId: true, status: true, startDate: true, endDate: true,
      user: { select: { name: true } },
    },
  });
  if (!req) return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });

  // 본인 것이 아니면 — 원장은 **담당 지점 직원**의 신청을 취소할 수 있다(2026-09-09 디렉터 지시).
  // 휴가 취소와 같은 기준이다. 관리자는 제한 없음.
  if (req.userId !== session.userId) {
    if (session.role === "EMPLOYEE") {
      return NextResponse.json({ error: "본인이 낸 신청만 취소할 수 있습니다." }, { status: 403 });
    }
    if (session.role === "MANAGER") {
      const { getManagerBranches } = await import("@/lib/manager-branches");
      const mine = await getManagerBranches(session.userId);
      const target = await prisma.user.findUnique({
        where: { id: req.userId }, select: { branch: true, role: true },
      });
      // 담당 지점에 속한 사람이면 **원장이라도** 취소할 수 있다(2026-09-10 디렉터 지시).
      // 결재함에는 원장 신청도 뜨는데 취소만 막혀 있어 누르면 403 이었다.
      // 관리자(ADMIN)는 지점 개념이 없으므로 대상에서 뺀다 — 원장이 관리자 건을
      // 거두면 안 된다.
      if (!target || target.role === "ADMIN" || !target.branch || !mine.includes(target.branch)) {
        return NextResponse.json({ error: "담당 지점 소속의 신청만 취소할 수 있습니다." }, { status: 403 });
      }
    }
  }
  // ⚠ **대기 중인 신청만** 취소한다. 승인된 신청은 이미 근무일정으로 반영돼 있어서,
  //   되돌리려면 그 일정을 어떻게 할지 따로 정해야 한다(휴가는 연차만 복원하면 되지만
  //   근무일정은 그렇지 않다). 승인된 건은 일정 화면에서 직접 고친다.
  if (req.status !== "PENDING") {
    return NextResponse.json(
      { error: `이미 ${req.status === "APPROVED" ? "승인" : "처리"}된 신청은 취소할 수 없습니다.` },
      { status: 409 }
    );
  }

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
