import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { isLeaveDeductible } from "@/lib/leave-types";
import { currentLeaveYear } from "@/lib/leave-calc";

// 휴가 신청 취소 — 본인은 대기 중인 건만, 원장.관리자는 담당 직원의 건을 처리할 수 있다.
// 취소하면 승인된 건의 연차가 복원되므로, 남의 건을 취소하면 감사로그와 당사자 DM 을 남긴다.
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { user: { select: { name: true } } },   // 감사로그에 남길 이름
  });

  if (!leave) return NextResponse.json({ error: "신청 내역이 없습니다." }, { status: 404 });

  // 본인 확인. ⚠ 종전에는 EMPLOYEE 만 본인 확인을 해서, **원장이 id 만 알면 타지점
  //   직원의 승인된 휴가를 취소하고 연차를 복원**할 수 있었다(2026-09-09 검증에서 적발).
  if (leave.userId !== session.userId) {
    if (session.role === "EMPLOYEE") {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
    if (session.role === "MANAGER") {
      const { getManagerBranches } = await import("@/lib/manager-branches");
      const mine = await getManagerBranches(session.userId);
      const target = await prisma.user.findUnique({
        where: { id: leave.userId },
        select: { branch: true, role: true },
      });
      if (!target || target.role !== "EMPLOYEE" || !target.branch || !mine.includes(target.branch)) {
        return NextResponse.json({ error: "담당 지점 직원의 휴가만 취소할 수 있습니다." }, { status: 403 });
      }
    }
  }

  // 이미 처리된 건은 취소 불가 (승인된 건은 관리자만 취소 가능)
  if (leave.status === "CANCELLED") {
    return NextResponse.json({ error: "이미 취소된 신청입니다." }, { status: 400 });
  }
  // ⚠ **본인 신청은 누구든 대기 중일 때만** 취소할 수 있다. 종전에는 EMPLOYEE 만
  //   이 제한을 받아서, 원장.관리자가 자기 승인된 휴가를 스스로 취소해 **연차를
  //   되돌릴 수** 있었다(기록도 안 남았다 — 2026-09-09 검증에서 적발).
  //   승인된 건을 되돌리는 것은 **남의 것을 처리하는 관리 행위**로만 남긴다.
  if (leave.userId === session.userId && leave.status !== "PENDING") {
    return NextResponse.json(
      { error: "이미 승인된 본인 휴가는 직접 취소할 수 없습니다. 관리자에게 요청해주세요." },
      { status: 403 }
    );
  }

  let done = false;
  await prisma.$transaction(async (tx) => {
    // ⚠ **조건부로** 바꾼다. 무조건 update 하면 두 사람이 동시에 취소할 때 잔여 복원이
    //   두 번 돌아 **연차가 2배로 복원**된다(2026-09-09 검증에서 적발).
    const claimed = await tx.leaveRequest.updateMany({
      where: { id, status: leave.status },
      data: { status: "CANCELLED" },
    });
    if (claimed.count === 0) return;
    done = true;

    // 남아 있는 결재 단계도 닫는다. 안 닫으면 취소된 휴가가 **결재함에 계속 떠 있다가**
    // 누군가 승인하면 되살아난다(근무일정에는 넣고 휴가만 빠뜨렸다).
    await tx.leaveApprovalStep.updateMany({
      where: { leaveRequestId: id, status: { in: ["PENDING", "WAITING"] } },
      data: { status: "REJECTED", comment: "신청 취소", decidedAt: new Date() },
    });

    // 승인된 건을 관리자가 취소하면 잔여 복원 (연차 차감 유형만, 현재 연도 행 — 차감과 동일 기준)
    if (leave.status === "APPROVED" && isLeaveDeductible(leave.type)) {
      await tx.leaveBalance.updateMany({
        where: { userId: leave.userId, year: currentLeaveYear() },
        data: {
          used:      { decrement: leave.days },
          remaining: { increment: leave.days },
        },
      });
    }
  });

  if (!done) {
    return NextResponse.json({ error: "이미 처리된 신청입니다." }, { status: 409 });
  }

  // 취소는 **항상** 기록한다. 종전에는 남의 것일 때만 남겨서, 본인이 취소한 건은
  // 흔적이 없었다 — 근무일정 취소는 항상 남긴다(2026-09-09 검증에서 비대칭 적발).
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  {
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "LEAVE_CANCEL",
      targetType: "LEAVE", targetId: id, targetName: leave.user?.name ?? null,
      detail: `휴가 취소 (${ymd(leave.startDate)} ~ ${ymd(leave.endDate)}, ${leave.days}일, 이전 상태 ${leave.status})`,
    });
  }

  // 남의 것을 취소했으면 당사자에게 알린다 — 모르는 사이에 휴가가 사라지면 안 된다
  if (leave.userId !== session.userId) {
    const { botSendDM } = await import("@/lib/bot");
    botSendDM(
      leave.userId,
      `휴가 신청이 취소되었습니다.

기간: ${ymd(leave.startDate)} ~ ${ymd(leave.endDate)}
처리: ${session.name}`
    ).catch(() => {});
  }

  return NextResponse.json({ success: true });
}
