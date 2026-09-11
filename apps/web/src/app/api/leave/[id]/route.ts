import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { leaveCancelDenial } from "@/lib/leave-cancel";
import { cancelViewerFor } from "@/lib/cancel-viewer";

// 휴가 신청 취소 — **대기 중인 신청만** 거둔다(연차 영향 없음). 본인은 자기 건, 원장.관리자는 담당 범위의 건.
// ⚠ 승인된 휴가는 여기서 취소하지 않는다(9/11 디렉터) — 본인이 "취소 결재"를 올려 관리자까지 승인받고,
//   연차 복구는 그 최종 승인에서만 한다(lib/leave-cancel-flow.ts). 남의 건을 거두면 감사로그와 당사자 DM.
export async function PATCH(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const leave = await prisma.leaveRequest.findUnique({
    where: { id },
    include: {
      user:          { select: { name: true, role: true, branch: true } },   // 감사로그 이름 + 범위 판정
      approver:      { select: { role: true } },                             // 최종 승인자 — 관리자 승인 건인가
      approvalSteps: { select: { approverRole: true, status: true } },
    },
  });

  if (!leave) return NextResponse.json({ error: "신청 내역이 없습니다." }, { status: 404 });

  // 누가 무엇을 취소할 수 있는지는 lib/leave-cancel.ts **한 곳에서만** 정한다.
  // 목록 API 가 같은 함수로 canCancel 을 내려주고 화면은 그 값으로만 버튼을 그린다.
  // (범위 · 원장끼리는 메인 원장만 · 반려건 덮어쓰기 금지 · 지난 휴가 금지 · **승인건은 취소 결재로만**).
  // 보는 사람 정보도 cancelViewerFor 한 곳에서 만든다.
  const denial = leaveCancelDenial(await cancelViewerFor(session), leave);
  if (denial) return NextResponse.json({ error: denial.error }, { status: denial.status });

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

    // 승인된 휴가는 여기로 오지 않는다(규칙이 NEEDS_REQUEST 로 막는다). 연차 복구는 취소 결재
    // 최종 승인에서만 한다(lib/leave-cancel-flow.ts) — 복구 경로를 한 곳으로 둔다(9/11).
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
