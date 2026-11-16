// 휴가 승인 · 반려 창구 — 회사 연동 키(ORG, scope leave:approve) 전용 (2026-11-16 이예지 요청, 디렉터 「처리해 주고」)
//
// 직영 포털이 매일 11시 팀즈 「직영_인사업무」 방에 원장 휴가 신청을 보고하고, 본부장님 · 팀장님이 「확인했어요」를 누르면
// 그 건을 큐브티에서 바로 승인(또는 반려)한다. 결재는 **화면과 같은 본체(lib/leave-decision decideLeave)** 로 한다 —
// 결재 차례 · 본인 결재 금지 · 잔여 재검사 · 동시 처리 막기 · 차감 · 봇 알림이 화면 결재와 똑같다.
//
//   POST /api/v1/leave/requests/{id}/approve  { approverEmpNo: "00000", memo?: string }
//   POST /api/v1/leave/requests/{id}/reject   { approverEmpNo: "00000", reason: string }
//
//  · approverEmpNo — 실제로 확인을 누른 분의 사번. **재직 중인 본부 관리자(ADMIN)** 만 받는다(원장 · 직원 이름으로는 결재하지 못한다).
//    결재 기록 · 감사 로그 · 신청자 알림에 이분 이름이 남는다. 신청자 본인은 안 된다.
//  · 결재선이 여러 단계면: 관리자 단계가 지금 차례면 그 단계만 넘어가고(다음 단계가 남으면 status=대기),
//    원장 단계가 차례이면 화면의 「관리자 직접 처리」처럼 남은 단계를 모두 닫고 최종 처리한다(원장 휴가는 결재선이 [관리자] 한 단계).
//  · 잔여가 모자라면 400 SHORT_BALANCE — 화면에서만 예외 승인할 수 있다(이 창구는 예외 승인하지 않는다).
//  · 이미 승인 · 반려 · 취소된 건은 409 ALREADY_DECIDED + 지금 상태.
//  · memo(승인)는 감사 기록에만 남기고 신청자 알림에는 넣지 않는다. reason(반려)은 화면 반려처럼 신청자에게 간다.
import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { isResigned } from "@/lib/resign";
import { decideLeave } from "@/lib/leave-decision";

const STATUS_LABEL: Record<string, string> = { PENDING: "대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소" };
const pad5 = (n: number | null | undefined) => (n == null ? null : String(n).padStart(5, "0"));
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "");

export async function handleLeaveDecisionApi(request: NextRequest, id: string, action: "approve" | "reject"): Promise<NextResponse> {
  const a = await authenticateApiKey(request, "leave:approve", "write");
  if ("res" in a) return a.res;
  if (a.p.key.kind !== "ORG") return v1Error(403, "회사 연동 키로만 쓸 수 있습니다.", "ORG_KEY_ONLY");

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return v1Error(400, "본문(JSON)이 필요합니다.", "BAD_BODY");
  const rawEmp = typeof body.approverEmpNo === "number" ? String(body.approverEmpNo) : typeof body.approverEmpNo === "string" ? body.approverEmpNo.trim() : "";
  if (!/^\d{1,9}$/.test(rawEmp)) return v1Error(400, "approverEmpNo(확인한 분의 사번)를 숫자로 보내주세요.", "BAD_APPROVER");
  const memo = clean(body.memo, 300);
  const reason = clean(body.reason, 500);
  if (action === "reject" && !reason) return v1Error(400, "반려 사유(reason)를 적어주세요.", "REASON_REQUIRED");

  // 결재자 — 재직 중인 본부 관리자만
  const approver = await prisma.user.findUnique({
    where: { empNo: Number(rawEmp) },
    select: { id: true, name: true, role: true, empNo: true, isActive: true, deletedAt: true, employmentStatus: true, resignDate: true },
  });
  if (!approver || !approver.isActive || approver.deletedAt || approver.employmentStatus === "RESIGNED" || isResigned(approver.resignDate))
    return v1Error(404, "approverEmpNo 에 해당하는 재직 중인 계정이 없습니다.", "APPROVER_NOT_FOUND");
  if (approver.role !== "ADMIN") return v1Error(403, "본부 관리자의 사번만 결재자로 받을 수 있습니다.", "APPROVER_NOT_ADMIN");

  const req = await prisma.leaveRequest.findUnique({ where: { id }, select: { id: true, userId: true, status: true } });
  if (!req) return v1Error(404, "신청을 찾을 수 없습니다.", "NOT_FOUND");
  if (req.status !== "PENDING")
    return NextResponse.json({ error: `이미 ${STATUS_LABEL[req.status] ?? req.status}된 신청입니다.`, code: "ALREADY_DECIDED", id: req.id, status: STATUS_LABEL[req.status] ?? req.status }, { status: 409 });
  if (req.userId === approver.id) return v1Error(403, "본인 휴가 신청은 결재할 수 없습니다.", "SELF_APPROVAL");

  const res = await decideLeave({ userId: approver.id, role: approver.role, name: approver.name }, id, { action, reason: action === "reject" ? reason : undefined });
  if (res.status !== 200) {
    const d = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (res.status === 409) {
      const now = await prisma.leaveRequest.findUnique({ where: { id }, select: { status: true } });
      // 다른 관리자가 같은 단계를 먼저 처리했는데 다음 단계가 남아 신청은 아직 대기인 경우 — 「이미 처리됨」과 구분한다(검증 C)
      const stillPending = now?.status === "PENDING";
      return NextResponse.json({ error: stillPending ? "이 단계는 다른 결재자가 먼저 처리했습니다. 신청은 다음 결재 단계에 있습니다." : d.error || "이미 처리된 신청입니다.",
        code: stillPending ? "STEP_ALREADY_TAKEN" : "ALREADY_DECIDED", id, status: now ? STATUS_LABEL[now.status] ?? now.status : null }, { status: 409 });
    }
    const code = d.code ?? (res.status === 403 ? "NOT_APPROVER" : res.status === 404 ? "NOT_FOUND" : "DECISION_FAILED");
    return v1Error(res.status, d.error || "처리하지 못했습니다.", code);
  }

  const after = await prisma.leaveRequest.findUnique({
    where: { id },
    select: { id: true, status: true, approvalSteps: { orderBy: { order: "asc" }, select: { status: true, approverId: true, decidedAt: true } } },
  });
  const mine = (after?.approvalSteps ?? []).filter((s) => s.approverId === approver.id && s.decidedAt).sort((x, y) => (y.decidedAt!.getTime() - x.decidedAt!.getTime()))[0];
  const remaining = (after?.approvalSteps ?? []).filter((s) => s.status === "PENDING" || s.status === "WAITING").length;
  await logAudit({
    actorId: approver.id, actorName: approver.name, action: "LEAVE_DECISION_VIA_KEY", targetType: "LEAVE", targetId: id, targetName: null,
    detail: `연동 키 「${a.p.key.name}」(발급 ${a.p.user.name})로 ${action === "approve" ? "승인" : "반려"}${memo ? ` · 메모: ${memo}` : ""}${remaining ? ` · 남은 단계 ${remaining}` : ""}`,
  });
  return NextResponse.json({
    id,
    status: after ? STATUS_LABEL[after.status] ?? after.status : null,
    finalized: !!after && after.status !== "PENDING",
    remainingSteps: remaining,
    decidedAt: (mine?.decidedAt ?? new Date()).toISOString(),
    approver: { empNo: pad5(approver.empNo), name: approver.name },
  }, { headers: { "Cache-Control": "no-store, private" } });
}
