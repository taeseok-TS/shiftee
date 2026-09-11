import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { getManagerBranches } from "@/lib/manager-branches";
import { kstTodayMidnight } from "@/lib/resign";
import { botNotifyApprovalRequest, botNotifyDecision } from "@/lib/bot";
import { applyLeaveCancel, CancelConflict, LEAVE_TYPE_LABEL, ymdOf } from "@/lib/leave-cancel-flow";

/**
 * 휴가 **취소 결재** 승인·반려 — 휴가 결재(api/leave/[id]/approve)와 **같은 구조**다.
 *  · action 은 approve / reject 만(오타가 조용히 반려되던 전례)
 *  · 단계 잡기는 조건부(CAS) — 두 번 눌러도 한 번만 처리
 *  · 사람을 못박은 단계(메인 원장)는 그 사람만 — 역할·지점 검사보다 **먼저** 본다
 *  · 원장은 자기 요청을 결재할 수 없다(관리자 승인 필수)
 *  · 결재 차례가 아닌데 처리하는 건 **관리자만** — 남은 단계를 모두 닫는다(직접처리)
 *  · 최종 승인 = 원 휴가 CANCELLED + 연차 복구(lib/leave-cancel-flow.ts applyLeaveCancel 한 곳)
 *  · 알림은 트랜잭션이 커밋된 뒤
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const rawAction = (body as { action?: unknown } | null)?.action;
  const rawReason = (body as { reason?: unknown } | null)?.reason;
  if (rawAction !== "approve" && rawAction !== "reject") {
    return NextResponse.json({ error: "요청이 올바르지 않습니다. (approve 또는 reject)" }, { status: 400 });
  }
  if (rawReason !== undefined && rawReason !== null && typeof rawReason !== "string") {
    return NextResponse.json({ error: "사유 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const action: "approve" | "reject" = rawAction;
  const reason = typeof rawReason === "string" && rawReason.trim() ? rawReason.trim().slice(0, 500) : undefined;

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const cr = await prisma.leaveCancelRequest.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true } },
      leaveRequest: {
        select: { id: true, userId: true, type: true, days: true, startDate: true, endDate: true, updatedAt: true },
      },
      approvalSteps: { orderBy: { order: "asc" } },
    },
  });
  if (!cr) return NextResponse.json({ error: "취소 요청을 찾을 수 없습니다." }, { status: 404 });
  if (cr.status !== "PENDING") {
    return NextResponse.json(
      { error: `이미 ${cr.status === "APPROVED" ? "승인" : "처리"}된 취소 결재입니다.` },
      { status: 409 }
    );
  }
  // 휴가 첫날부터는 취소 결재를 **승인하지 않는다**(9/11 디렉터 — 진행 중 휴가는 취소 대상이 아니다).
  // 반려는 막지 않는다(휴가가 그대로 남으므로 해가 없다). 남은 요청은 봇이 매시 기한 만료로 닫는다.
  if (action === "approve" && cr.leaveRequest.startDate.getTime() <= kstTodayMidnight().getTime()) {
    return NextResponse.json(
      { error: "휴가가 이미 시작돼 취소 결재를 승인할 수 없습니다. 이 요청은 기한 만료로 정리됩니다. 연차 정정은 관리자 '잔여 조정'으로 해주세요." },
      { status: 409 }
    );
  }
  if (session.role === "MANAGER" && cr.userId === session.userId) {
    return NextResponse.json(
      { error: "본인 휴가의 취소 요청은 직접 결재할 수 없습니다. 관리자 승인이 필요합니다." },
      { status: 403 }
    );
  }

  const steps = cr.approvalSteps;
  const myStep = steps.find((s) => {
    if (s.status !== "PENDING") return false;
    if (s.approverId) return s.approverId === session.userId;   // 못박은 단계는 그 사람만
    if (s.approverRole === "ADMIN") return session.role === "ADMIN";
    if (s.approverRole === "MANAGER") return session.role === "MANAGER" && !!s.branch && myBranches.includes(s.branch);
    return false;
  });
  if (!myStep && session.role !== "ADMIN") {
    return NextResponse.json({ error: "결재 차례가 아닙니다." }, { status: 403 });
  }
  const override = !myStep;   // 관리자 직접처리

  const out: {
    done: boolean;
    final: boolean;
    next: { approverRole: string | null; branch: string | null; approverId: string | null } | null;
    restored: { restoredDays: number; year: number } | null;
  } = { done: false, final: false, next: null, restored: null };
  const decidedAt = new Date();
  const stepStatus = action === "approve" ? ("APPROVED" as const) : ("REJECTED" as const);

  try {
    await prisma.$transaction(async (tx) => {
      if (override) {
        const closed = await tx.leaveCancelStep.updateMany({
          where: { cancelRequestId: id, status: { in: ["PENDING", "WAITING"] } },
          data: { status: stepStatus, approverId: session.userId, comment: reason ?? "관리자 직접처리", decidedAt },
        });
        if (closed.count === 0) return;
      } else {
        const claimed = await tx.leaveCancelStep.updateMany({
          where: { id: myStep!.id, status: "PENDING" },
          data: { status: stepStatus, approverId: session.userId, comment: reason ?? null, decidedAt },
        });
        if (claimed.count === 0) return;
      }
      out.done = true;

      if (action === "reject") {
        const r = await tx.leaveCancelRequest.updateMany({
          where: { id, status: "PENDING" },
          data: { status: "REJECTED", approverId: session.userId, rejectedReason: reason ?? null },
        });
        if (r.count !== 1) throw new CancelConflict("이미 처리된 취소 결재입니다.");
        await tx.leaveCancelStep.updateMany({
          where: { cancelRequestId: id, status: "WAITING" },
          data: { status: "REJECTED" },
        });
        out.final = true;
        return;
      }

      const nextStep = override ? undefined : steps.find((s) => s.order === myStep!.order + 1 && s.status === "WAITING");
      if (nextStep) {
        await tx.leaveCancelStep.update({ where: { id: nextStep.id }, data: { status: "PENDING" } });
        out.next = { approverRole: nextStep.approverRole, branch: nextStep.branch, approverId: nextStep.approverId };
        return;
      }
      out.restored = await applyLeaveCancel(tx, id, cr.leaveRequest, session.userId);
      out.final = true;
    });
  } catch (e) {
    if (e instanceof CancelConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    throw e;
  }
  if (!out.done) return NextResponse.json({ error: "이미 처리된 결재입니다." }, { status: 409 });

  const lr = cr.leaveRequest;
  const period = `${ymdOf(lr.startDate)} ~ ${ymdOf(lr.endDate)}`;
  const typeLabel = LEAVE_TYPE_LABEL[lr.type] || lr.type;
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "LEAVE_CANCEL_DECISION",
    targetType: "LEAVE", targetId: lr.id, targetName: cr.user.name,
    detail: `${cr.user.name} ${typeLabel} 휴가 취소 결재 ${action === "approve" ? "승인" : "반려"}${override ? " (직접처리)" : ""} (${period})`,
  });
  if (out.restored) {
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "LEAVE_CANCEL",
      targetType: "LEAVE", targetId: lr.id, targetName: cr.user.name,
      detail: `휴가 취소 확정(취소 결재 최종 승인) (${period}, ${lr.days}일) — 연차 ${out.restored.restoredDays}일 복구(${out.restored.year}년)`,
    });
  }

  if (out.next) {
    botNotifyApprovalRequest(out.next, {
      kind: "휴가 취소",
      requesterName: cr.user.name,
      period,
      requesterId: cr.userId,
    }).catch(() => {});
  }
  if (out.final) {
    botNotifyDecision(cr.userId, `${typeLabel} 휴가 취소 요청 (${period})`, action === "approve", session.name, reason).catch(() => {});
  }
  return NextResponse.json({ success: true, final: out.final, restoredDays: out.restored?.restoredDays ?? 0 });
}
