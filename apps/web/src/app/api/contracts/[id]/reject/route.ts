import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * 계약 반려 (2026-09-04, 디렉터 지시)
 *
 * 종전에는 결재자가 "거부"할 수단이 아예 없었다. 조건이 맞지 않으면 그냥 서명을 안 하고
 * 버티는 수밖에 없어서 **이유가 어디에도 기록되지 않았고**, 관리자는 왜 멈춰 있는지 몰랐다.
 *
 * 규칙(디렉터 결정):
 *  - 반려는 **최종 상태**다. 다시 진행하려면 관리자가 계약을 새로 만들어 발송한다.
 *  - **직원 본인도** 자기 서명 차례에 반려할 수 있다(결재자와 같은 규칙).
 *  - 사유는 필수다. 사유 없는 반려는 받는 쪽에서 아무 것도 할 수 없다.
 *
 * 새 컬럼을 만들지 않는다 — 누가.언제.왜는 단계(status/comment/decidedAt)와 계약의
 * revocationLog 에 남는다. 운영 DB 드리프트로 사고를 여러 번 냈다.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  const reason = (body.reason || "").trim();
  if (!reason) return NextResponse.json({ error: "반려 사유를 입력해주세요." }, { status: 400 });
  if (reason.length > 500)
    return NextResponse.json({ error: "반려 사유는 500자까지 입력할 수 있습니다." }, { status: 400 });

  const contract = await prisma.contract.findUnique({
    where: { id },
    include: { approvalLine: { include: { steps: { orderBy: { order: "asc" } } } } },
  });
  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  if (!contract.approvalLine) return NextResponse.json({ error: "승인라인이 없습니다." }, { status: 400 });

  // 이미 끝난 계약은 되돌리지 않는다. 완료본이 나간 뒤의 반려는 회수(revoke)로 다뤄야 한다.
  if (contract.status === "SIGNED")
    return NextResponse.json({ error: "이미 완료된 계약은 반려할 수 없습니다. 회수를 사용하세요." }, { status: 400 });
  if (contract.status === "REJECTED")
    return NextResponse.json({ error: "이미 반려된 계약입니다." }, { status: 400 });

  // **자기 차례일 때만** 반려할 수 있다. 관리자라도 남의 차례를 대신 반려하지 않는다 —
  // 그건 회수(revoke)의 일이고, 둘을 섞으면 누가 거부한 것인지 기록이 흐려진다.
  const myStep = contract.approvalLine.steps.find(
    (s) => s.approverId === session.userId && s.status === "PENDING"
  );
  if (!myStep)
    return NextResponse.json({ error: "지금 반려할 수 있는 단계가 없습니다." }, { status: 403 });

  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    await tx.contractApprovalStep.update({
      where: { id: myStep.id },
      data: { status: "REJECTED", comment: reason, decidedAt: now },
    });
    // 남은 단계도 함께 닫는다. 안 닫으면 뒷사람 결재함에 그대로 남아 "반려됐는데 결재하라"가 된다.
    await tx.contractApprovalStep.updateMany({
      where: { approvalLineId: contract.approvalLine!.id, status: { in: ["WAITING", "PENDING"] } },
      data: { status: "REJECTED", decidedAt: now },
    });
    const logs = Array.isArray(contract.revocationLog) ? (contract.revocationLog as unknown[]) : [];
    return tx.contract.update({
      where: { id },
      data: {
        status: "REJECTED",
        revocationLog: [...logs, {
          type: "reject",
          stepOrder: myStep.order,
          reason,
          rejectedBy: session.userId,
          rejectedAt: now.toISOString(),
        }] as never,
      },
      include: {
        user: { select: { id: true, name: true } },
        approvalLine: { include: { steps: { orderBy: { order: "asc" } } } },
      },
    });
  });

  // 알림 — 작성자.당사자.이미 결재한 사람들에게. 반려한 본인은 뺀다.
  // 알림 실패가 반려를 되돌리면 안 되므로 응답 뒤에 보내되, 실패는 기록한다.
  void (async () => {
    try {
      const { botSendDM } = await import("@/lib/bot");
      const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true } });
      const targets = new Set<string>();
      if (contract.createdBy) targets.add(contract.createdBy);
      if (contract.userId) targets.add(contract.userId);
      for (const st of contract.approvalLine!.steps) {
        if (st.status === "APPROVED" && st.approverId) targets.add(st.approverId);
      }
      targets.delete(session.userId);
      const who = me?.name || "결재자";
      const isSelf = myStep.approverId === contract.userId;
      const head = isSelf ? `${who} 님이 서명을 거부했습니다` : `${who} 님이 계약을 반려했습니다`;
      const text = `📄 ${head}\n\n「${contract.title}」\n사유: ${reason}\n\n`
        + `이 계약은 반려로 종료됐습니다. 다시 진행하려면 계약을 새로 만들어 발송해 주세요.`;
      for (const uid of targets) await botSendDM(uid, text).catch(() => {});
    } catch (e) {
      const { logSystemError } = await import("@/lib/monitor");
      await logSystemError({
        path: `/api/contracts/${id}/reject`, method: "POST",
        message: `반려 알림 발송 실패: ${(e as Error)?.message || String(e)}`,
      }).catch(() => {});
    }
  })();

  return NextResponse.json({ success: true, message: "반려했습니다.", contract: result });
}
