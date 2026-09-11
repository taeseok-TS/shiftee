import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { kstTodayMidnight } from "@/lib/resign";
import { cancelRequestDenial } from "@/lib/leave-cancel";
import { leavePolicySteps } from "@/lib/leave-policy";
import { applyLeaveCancel, CancelConflict, ymdOf } from "@/lib/leave-cancel-flow";
import { botNotifyApprovalRequest } from "@/lib/bot";

/**
 * 승인된 휴가의 **취소 결재** 올리기 (디렉터 확정 2026-09-11).
 *  · 휴가 쓴 **본인만** 올린다 · **시작 전날까지** · 휴가 하나에 진행 중인 취소 결재는 하나
 *    (판정은 lib/leave-cancel.ts cancelRequestDenial — 목록 API 의 canRequestCancel 과 같은 함수)
 *  · 결재선은 휴가 신청과 **같은 정책 함수**(lib/leave-policy.ts), 단 취소는 일수와 무관하게 **항상 관리자까지**
 *  · 결재가 도는 동안 연차는 차감된 채 — 복구는 최종 승인 때(lib/leave-cancel-flow.ts)
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;

  // 본문은 선택(사유만). 모양이 틀리면 400 — 객체가 오면 String() 이 던져 500 이 되던 전례가 있다
  const body = await request.json().catch(() => ({}));
  const rawReason = (body as { reason?: unknown } | null)?.reason;
  if (rawReason !== undefined && rawReason !== null && typeof rawReason !== "string") {
    return NextResponse.json({ error: "사유 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim().slice(0, 500) : null;

  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: {
      user: { select: { name: true } },
      cancelRequests: { where: { status: "PENDING" }, select: { id: true } },
    },
  });
  if (!leave) return NextResponse.json({ error: "휴가 신청을 찾을 수 없습니다." }, { status: 404 });

  const denial = cancelRequestDenial(
    { userId: session.userId, today: kstTodayMidnight() },
    leave,
    leave.cancelRequests.length > 0
  );
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status });

  const steps = await leavePolicySteps(session.userId, { days: leave.days, forCancel: true });

  // 트랜잭션 콜백 안에서 채우는 값 — let 으로 두면 TS 가 null 로 좁혀 버린다
  const out: { id: string; restored: { restoredDays: number; year: number } | null } = { id: "", restored: null };
  try {
    await prisma.$transaction(async (tx) => {
      const cr = await tx.leaveCancelRequest.create({
        data: { leaveRequestId: leave.id, userId: session.userId, reason, status: "PENDING" },
      });
      out.id = cr.id;
      if (steps.length > 0) {
        await tx.leaveCancelStep.createMany({
          data: steps.map((st, idx) => ({
            cancelRequestId: cr.id,
            order: idx + 1,
            approverRole: st.approverRole,
            branch: st.branch,
            approverId: st.approverId ?? null,   // 메인 원장처럼 사람을 못박은 단계
            status: idx === 0 ? ("PENDING" as const) : ("WAITING" as const),
          })),
        });
      } else {
        // 결재선이 없는 경우(다른 관리자가 없는 관리자 본인) — 휴가 신청의 자동 승인과 같은 규칙
        out.restored = await applyLeaveCancel(tx, cr.id, leave, session.userId);
      }
    });
  } catch (e) {
    if (e instanceof CancelConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    // 같은 휴가에 대기 중인 취소 결재는 하나 — DB 부분 유일 인덱스가 동시 요청(더블클릭)을 막는다
    if ((e as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "이미 취소 결재가 진행 중입니다." }, { status: 409 });
    }
    throw e;
  }

  const period = `${ymdOf(leave.startDate)} ~ ${ymdOf(leave.endDate)}`;
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "LEAVE_CANCEL_REQUEST",
    targetType: "LEAVE", targetId: leave.id, targetName: leave.user?.name ?? null,
    detail: `휴가 취소 결재 올림 (${period}, ${leave.days}일)${reason ? ` — 사유: ${reason}` : ""}`,
  });
  if (out.restored) {
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "LEAVE_CANCEL",
      targetType: "LEAVE", targetId: leave.id, targetName: leave.user?.name ?? null,
      detail: `휴가 취소 확정(결재선 없음·자동) (${period}, ${leave.days}일) — 연차 ${out.restored.restoredDays}일 복구(${out.restored.year}년)`,
    });
  }

  // 알림은 트랜잭션이 커밋된 뒤 — 실패가 요청을 되돌리면 안 된다
  if (steps.length > 0) {
    botNotifyApprovalRequest(steps[0], {
      kind: "휴가 취소",
      requesterName: session.name,
      period,
      requesterId: session.userId,
    }).catch(() => {});
  }

  return NextResponse.json({ success: true, cancelRequestId: out.id, autoApproved: !!out.restored });
}
