import { NextRequest, NextResponse } from "next/server";
import { getSession, bumpTokenVersion } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { approverScopeFor } from "@/lib/approval-delegate";
import { personLabelOf, recordAttendanceEdit } from "@/lib/attendance-edit";
import {
  KIND_LABEL, RequestConflict, STEP1_AUDIT, TWO_STEP_KINDS, applyApproved, canDecide, kstDateTime, statusSummaryOf, summaryOf, ymdOfDate,
  type RequestKind,
} from "@/lib/attendance-request";
import { canSeeClockTimes } from "@/lib/attendance-visibility";

export const dynamic = "force-dynamic";

/** 출근 요청이 반려·취소되면 그날 대기 중인 지점 밖·사진·본부 퇴근 요청도 거둔다 */
async function cancelDependentOut(userId: string, workDate: Date, why: string) {
  await prisma.attendanceRequest.updateMany({
    where: { userId, workDate, action: "OUT", status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date(), rejectReason: why },
  }).catch(() => {});
}

// 출퇴근 요청 처리 — POST { action: "approve" | "reject", reason?, clockIn?, clockOut? } / 본인 취소 DELETE
//  · 출퇴근 수정(CORRECTION · MISSED_OUT)은 「지점 원장 → 본부」(2026-10-23 ■0-11): 원장(대행 포함)이 승인하면 기록은 그대로 두고
//    본부 차례로 넘긴다(approverRole → ADMIN, 상태는 PENDING). 본부가 최종 승인할 때 기록에 반영한다.
//  · 넣을 시각은 본부 단계에서 확인 · 확정 — 본부는 승인하면서 clockIn · clockOut("HH:mm", 그날 KST)으로 직원이 적은 시각을 고칠 수 있다.
//    퇴근이 출근보다 이르면 다음 날 새벽으로 본다(요청 만들 때와 같다). 본부가 아니면 시각 칸은 받지 않는다
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: unknown; reason?: unknown; clockIn?: unknown; clockOut?: unknown } | null;
  if (body?.action !== "approve" && body?.action !== "reject")
    return NextResponse.json({ error: "요청이 올바르지 않습니다. (approve 또는 reject)" }, { status: 400 });
  if (body.reason != null && typeof body.reason !== "string")
    return NextResponse.json({ error: "사유 형식이 올바르지 않습니다." }, { status: 400 });
  const approve = body.action === "approve";
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 300) : null;

  const r = await prisma.attendanceRequest.findUnique({ where: { id }, include: { user: { select: { name: true, role: true, branch: true } } } });
  if (!r) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
  if (r.status !== "PENDING") return NextResponse.json({ error: "이미 처리된 요청입니다." }, { status: 409 });
  if (r.userId === session.userId) return NextResponse.json({ error: "본인 요청은 직접 처리할 수 없습니다." }, { status: 403 });
  const scope = await approverScopeFor(session);
  if (!canDecide(r, session, scope, r.user.role)) return NextResponse.json({ error: "처리 권한이 없습니다." }, { status: 403 });

  // 1차(원장) 승인 — 출퇴근 수정은 기록을 바꾸지 않고 본부 차례로 넘긴다(■0-11). 본부가 원장 단계에서 바로 처리하면 그대로 최종
  if (approve && session.role !== "ADMIN" && r.approverRole === "MANAGER" && TWO_STEP_KINDS.includes(r.kind)) {
    try {
      await prisma.$transaction(async (tx) => {
        const moved = await tx.attendanceRequest.updateMany({
          where: { id, status: "PENDING", approverRole: "MANAGER" },
          data: { approverRole: "ADMIN" },
        });
        if (moved.count === 0) throw new RequestConflict("이미 처리된 요청입니다.");
        // 누가 1차 승인했는지 — 같은 트랜잭션(logAudit 은 실패를 삼키므로 여기서는 직접 쓴다)
        await tx.auditLog.create({
          data: {
            actorId: session.userId, actorName: session.name, action: STEP1_AUDIT,
            targetType: "AttendanceRequest", targetId: r.id, targetName: r.user.name,
            detail: `${KIND_LABEL[r.kind as RequestKind] ?? r.kind} 1차 승인(원장): ${r.user.name} · ${summaryOf(r)} → 본부 확인 대기`,
          },
        });
      });
    } catch (e) {
      if (e instanceof RequestConflict) return NextResponse.json({ error: e.message }, { status: 409 });
      throw e;
    }
    // 본부 차례 알림(시각 포함 — 본부가 확인한다). 직원에게는 최종 결과만 알린다
    const { botNotifyApprovalRequest } = await import("@/lib/bot");
    botNotifyApprovalRequest(
      { approverRole: "ADMIN", branch: r.branch, approverId: null },
      { kind: "출퇴근 요청", requesterName: r.user.name, period: summaryOf(r), requesterId: r.userId, prevApprover: `${session.name} ${session.role === "MANAGER" ? "원장" : "(원장대행)"}` },
    ).catch(() => {});
    return NextResponse.json({ success: true, step: "HQ", message: "1차 승인했습니다. 본부가 시각을 확인해 최종 승인합니다." });
  }

  // 본부가 최종 승인하면서 시각을 고칠 때(출퇴근 수정만)
  let fixed: { clockIn: Date | null; clockOut: Date | null } | null = null;
  if (approve && (body.clockIn != null || body.clockOut != null)) {
    if (session.role !== "ADMIN") return NextResponse.json({ error: "시각은 본부 단계에서 확인합니다." }, { status: 403 });
    if (!TWO_STEP_KINDS.includes(r.kind)) return NextResponse.json({ error: "이 요청은 시각을 고칠 수 없습니다." }, { status: 400 });
    const ymd = ymdOfDate(r.workDate);
    const parse = (v: unknown): Date | null | "bad" => (v == null || v === "" ? null : typeof v === "string" ? kstDateTime(ymd, v) ?? "bad" : "bad");
    const inAt = parse(body.clockIn), outRaw = parse(body.clockOut);
    if (inAt === "bad" || outRaw === "bad") return NextResponse.json({ error: "시각은 HH:mm 으로 넣어 주세요." }, { status: 400 });
    if (r.kind === "MISSED_OUT" && inAt) return NextResponse.json({ error: "퇴근 누락 요청은 퇴근 시각만 고칩니다." }, { status: 400 });
    let outAt = outRaw;
    const baseIn = inAt ?? r.clockIn
      ?? (await prisma.attendance.findUnique({ where: { userId_date: { userId: r.userId, date: r.workDate } }, select: { clockIn: true } }))?.clockIn ?? null;
    if (outAt && baseIn && outAt <= baseIn) outAt = new Date(outAt.getTime() + 86400_000);   // 자정 넘긴 근무
    const now = Date.now();
    if ((inAt && inAt.getTime() > now) || (outAt && outAt.getTime() > now)) return NextResponse.json({ error: "아직 오지 않은 시각입니다." }, { status: 400 });
    fixed = { clockIn: inAt ?? r.clockIn, clockOut: outAt ?? r.clockOut };
  }
  const req = fixed ? { ...r, ...fixed } : r;
  if (approve && r.kind === "CORRECTION" && !req.clockIn && !req.clockOut)
    return NextResponse.json({ error: "넣을 출근 또는 퇴근 시각을 적어 주세요." }, { status: 400 });
  if (approve && r.kind === "MISSED_OUT" && !req.clockOut)
    return NextResponse.json({ error: "넣을 퇴근 시각을 적어 주세요." }, { status: 400 });

  let deviceChanged = false;
  // 수정 이력에 박을 이름(그 시점 「이름 직급」) — 요청한 직원과 승인한 사람(#219-15)
  const [requesterName, deciderName] = approve
    ? await Promise.all([personLabelOf(r.userId, r.user.name), personLabelOf(session.userId, session.name)])
    : ["", ""];
  // 출퇴근 수정을 원장이 1차 승인했으면 수정 이력의 승인자에 둘 다 — 「김준수 원장 → 이예지 대리」(■0-11)
  let approverName = deciderName;
  if (approve && TWO_STEP_KINDS.includes(r.kind)) {
    const s1 = await prisma.auditLog.findFirst({ where: { action: STEP1_AUDIT, targetId: r.id }, orderBy: { createdAt: "asc" }, select: { actorId: true, actorName: true } });
    if (s1) approverName = `${await personLabelOf(s1.actorId, s1.actorName)} → ${deciderName}`;
  }
  try {
    await prisma.$transaction(async (tx) => {
      // 먼저 잡는다 — 두 사람이 동시에 눌러도 한 번만 반영
      const claimed = await tx.attendanceRequest.updateMany({
        where: { id, status: "PENDING" },
        data: {
          status: approve ? "APPROVED" : "REJECTED", decidedBy: session.userId, decidedAt: new Date(), rejectReason: approve ? null : reason,
          ...(fixed ? { clockIn: fixed.clockIn, clockOut: fixed.clockOut } : {}),   // 본부가 확정한 시각을 요청에도 남긴다
        },
      });
      if (claimed.count === 0) throw new RequestConflict("이미 처리된 요청입니다.");
      if (!approve) return;
      const applied = await applyApproved(tx, req, session.role);
      deviceChanged = !!applied.deviceChanged;
      // 기록을 바꿨으면 같은 트랜잭션으로 수정 이력 — 원래 시각·직원이 쓴 사유·승인자(#219-15)
      if (applied.edit)
        await recordAttendanceEdit(tx, {
          ...applied.edit, userId: r.userId, workDate: r.workDate, kind: `REQUEST_${r.kind}`,
          reason: r.reason, requestId: r.id,
          editorId: r.userId, editorName: requesterName, approverName,
        });
    });
  } catch (e) {
    if (e instanceof RequestConflict) return NextResponse.json({ error: e.message }, { status: 409 });
    // 같은 사람·같은 날 기록이 동시에 만들어지면(출근 버튼과 승인이 겹침) — 되돌려졌으니 다시 누르면 된다
    if ((e as { code?: string })?.code === "P2002")
      return NextResponse.json({ error: "같은 날 기록이 방금 바뀌었습니다. 다시 눌러 주세요." }, { status: 409 });
    throw e;
  }
  // 기기를 바꿨으면 옛 기기에 남은 세션을 끊는다(기기 초기화와 같은 처리)
  if (deviceChanged) await bumpTokenVersion(r.userId).catch(() => {});
  // 출근 요청을 반려하면 그날 대기 중인 퇴근 요청도 함께 거둔다(출근 없이 퇴근만 남지 않게)
  if (!approve && r.action === "IN") await cancelDependentOut(r.userId, r.workDate, "출근 요청 반려로 함께 취소");

  const label = KIND_LABEL[r.kind as RequestKind] ?? r.kind;
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "ATTENDANCE_REQUEST_DECISION",
    targetType: "AttendanceRequest", targetId: r.id, targetName: r.user.name,
    detail: `${label} ${approve ? "승인" : "반려"}: ${r.user.name} · ${summaryOf(req)}${fixed ? " (본부가 시각 확정)" : ""}${!approve && reason ? ` · 사유: ${reason}` : ""}`,
  });
  // 신청자(직원 · 원장)에게 가는 결과 알림에는 시각을 싣지 않는다(■0-11)
  const { botNotifyDecision } = await import("@/lib/bot");
  const told = (await canSeeClockTimes(r.user.role)) ? summaryOf(req) : statusSummaryOf(req);
  // 기록 요청 승인이면 결과 알림 한 통에 「어디서 보이는지」를 합친다(알림 두 통 대신, 2026-10-27 이예지 ⑦)
  const recordHint = approve && r.kind === "RECORD" ? " — 출퇴근 › 지난 기록(웹 「내 출퇴근」 지난 7일 · 날짜별 상태, 앱 지난 기록)에서 그 기간의 출근 · 퇴근 시각이 보입니다. 다른 날짜는 상태만 보입니다" : "";
  botNotifyDecision(r.userId, `${label} (${told})${recordHint}`, approve, session.name, reason,
    { actorId: session.userId, actorRole: session.role }).catch(() => {});
  // 출퇴근 기록 요청 승인 = 요청 기간 열람 허용(lib/record-grants, 2026-10-27 이예지 ⑦) — 본인과 그 지점 원장(둘이면 둘 다)에게 알린다
  if (approve && r.kind === "RECORD") {
    const { recordPeriodLabel } = await import("@/lib/attendance-request");
    const { botSendDM } = await import("@/lib/bot");
    const { branchManagers } = await import("@/lib/manager-branches");
    const period = recordPeriodLabel(r.memo ?? null) ?? "요청 기간";
    // 원장은 「지점 출퇴근 기록 열람」(권한 설정)이 켜져 있을 때만 — 꺼져 있으면 보드가 열리지 않아 알림이 거짓이 된다
    const { isAllowed } = await import("@/lib/permission-settings");
    const managers = r.user.branch && (await isAllowed("manager.viewAttendance")) ? await branchManagers(r.user.branch).catch(() => [] as { id: string }[]) : [];
    for (const m of managers) {
      if (m.id === r.userId) continue;
      botSendDM(m.id, `${r.user.name} 님의 출퇴근 기록 요청이 승인되었습니다 (${period}).\n「지점 출퇴근기록」에서 그 기간의 출근 · 퇴근 시각 · 일한 시간이 보입니다(보기만 — 수정은 수정 요청 → 본부).`).catch(() => {});
    }
  }
  return NextResponse.json({
    success: true, step: "DONE",
    message: !approve ? "반려했습니다." : r.kind === "RECORD" ? "승인했습니다. 본인과 지점 원장에게 요청 기간의 출퇴근 시각이 열립니다." : "승인했습니다. 출퇴근 기록에 반영했습니다.",
  });
}

// 본인이 대기 중인 요청을 거둔다
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const claimed = await prisma.attendanceRequest.updateMany({
    where: { id, userId: session.userId, status: "PENDING" },
    data: { status: "CANCELLED", decidedAt: new Date() },
  });
  if (claimed.count === 0) return NextResponse.json({ error: "취소할 수 있는 요청이 없습니다." }, { status: 409 });
  const r = await prisma.attendanceRequest.findUnique({ where: { id } });
  if (r?.action === "IN") await cancelDependentOut(r.userId, r.workDate, "출근 요청 취소로 함께 취소");
  if (r) {
    const { botNotifyAdminsProgress } = await import("@/lib/bot");
    botNotifyAdminsProgress(`${session.name} · ${KIND_LABEL[r.kind as RequestKind] ?? r.kind} 요청 취소 (${summaryOf(r)})`, [session.userId]).catch(() => {});
  }
  return NextResponse.json({ success: true });
}
