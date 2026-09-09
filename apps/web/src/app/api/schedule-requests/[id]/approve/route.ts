import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { materializeSchedules } from "@/lib/schedule-materialize";
import { logAudit } from "@/lib/audit";
import { botNotifyDecision, botNotifyApprovalRequest } from "@/lib/bot";
import { getManagerBranches } from "@/lib/manager-branches";

function fmtRange(s: Date, e: Date) {
  const f = (d: Date) => d.toISOString().split("T")[0];
  return `${f(s)} ~ ${f(e)}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const { id } = await params;
  // ⚠ try 밖이라 여기서 던지면 미처리 500 이 된다 — 본문 없이 부르면 누구나 오류 로그를
  //   하나씩 만들 수 있었다(2026-09-09 검증에서 실측).
  const body = await request.json().catch(() => null);
  const rawAction = (body as { action?: unknown } | null)?.action;
  const rawReason = (body as { reason?: unknown } | null)?.reason;
  // ⚠ action 을 검증한다. 종전에는 `action === "approve" ? 승인 : 반려` 라서
  //   오타.누락.대소문자가 다르면 **조용히 반려**되고 신청자에게 반려 알림이 나갔다.
  if (rawAction !== "approve" && rawAction !== "reject") {
    return NextResponse.json({ error: "요청이 올바르지 않습니다. (approve 또는 reject)" }, { status: 400 });
  }
  if (rawReason !== undefined && rawReason !== null && typeof rawReason !== "string") {
    return NextResponse.json({ error: "사유 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const action: "approve" | "reject" = rawAction;
  const reason: string | undefined = typeof rawReason === "string" ? rawReason : undefined; // action: 'approve' | 'reject'

  const scheduleRequest = await prisma.scheduleRequest.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, branch: true } },
      approvalSteps: {
        orderBy: { order: "asc" },
        include: { approver: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  if (!scheduleRequest) {
    return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });
  }

  // ⚠ 이미 끝난 신청은 어느 경로로도 다시 처리하지 않는다. 종전에는 우회 경로에만
  //   검사가 있어서, 단계별 경로로 들어오면 취소.반려된 신청도 되살아났다
  //   (2026-09-09 검증에서 적발).
  if (scheduleRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: `이미 ${scheduleRequest.status === "APPROVED" ? "승인" : "처리"}된 신청입니다.` },
      { status: 409 }
    );
  }

  const steps = scheduleRequest.approvalSteps;

  if (steps.length > 0) {
    // 내가 결재해야 할 PENDING 스텝 찾기 (역할/지점 기반)
    const myStep = steps.find((s) => {
      if (s.status !== "PENDING") return false;
      if (s.approverRole === "ADMIN") return session.role === "ADMIN";
      if (s.approverRole === "MANAGER") return session.role === "MANAGER" && !!s.branch && myBranches.includes(s.branch);
      return s.approverId === session.userId;
    });

    // ⚠ **원장은 자기 신청을 스스로 결재할 수 없다** (2026-09-08 디렉터 지시).
    //   원장 신청의 결재선은 [관리자] 한 단계인데, 종전에는 아래 우회 경로로 빠져
    //   **본인이 본인 것을 최종 승인**할 수 있었다. 원장끼리 품앗이도 가능했다
    //   (한 지점에 원장이 2명인 곳이 실재한다).
    if (session.role === "MANAGER" && scheduleRequest.userId === session.userId) {
      return NextResponse.json(
        { error: "본인 근무일정 신청은 직접 결재할 수 없습니다. 관리자 승인이 필요합니다." },
        { status: 403 }
      );
    }

    // 관리자가 아니고 결재 차례도 아닌 경우
    if (!myStep && session.role === "EMPLOYEE") {
      return NextResponse.json({ error: "결재 권한이 없습니다." }, { status: 403 });
    }

    // 결재 차례가 아닌데 처리하려는 경우 = 결재라인 우회.
    // ⚠ **관리자에게만 허용한다.** 종전에는 원장도 여기로 빠질 수 있어서,
    //   주말 신청 [원장 → 관리자] 에서 원장이 1단계를 승인한 뒤 한 번 더 부르면
    //   **관리자 단계를 건너뛰고 최종 승인**됐다(2026-09-08 검증에서 적발).
    //   원장은 자기 차례(myStep)일 때만 결재한다.
    if (!myStep && session.role === "MANAGER") {
      return NextResponse.json(
        { error: "결재 차례가 아닙니다. 관리자 결재가 남아 있습니다." },
        { status: 403 }
      );
    }
    if (!myStep && session.role === "ADMIN") {
      return await adminOverride(id, action, reason, session.userId);
    }

    // 단계별 처리
    let emailAction: "approve" | "reject" | "next_approver" | null = null;
    let nextApprover: any = null;
    let notifyNext: { approverRole: string | null; branch: string | null; approverId: string | null } | null = null;

    let alreadyDone = false;
    await prisma.$transaction(async (tx) => {
      // **조건부로** 쓴다. 결재자가 두 번 누르거나 두 사람이 동시에 처리하면
      // 종전에는 같은 단계가 두 번 처리돼 감사로그.DM 이 겹치고, 마지막 단계면
      // 근무일정 반영이 두 번 돌았다(2026-09-09 검증에서 적발).
      const claimed = await tx.scheduleApprovalStep.updateMany({
        where: { id: myStep!.id, status: "PENDING" },
        data: {
          status: action === "approve" ? "APPROVED" : "REJECTED",
          approverId: session.userId, // 실제 결재자 기록
          comment: reason ?? null,
          decidedAt: new Date(),
        },
      });
      if (claimed.count === 0) { alreadyDone = true; return; }

      if (action === "reject") {
        // 반려: 전체 요청 반려
        await tx.scheduleRequest.update({
          where: { id },
          data: {
            status: "REJECTED",
          },
        });
        // 나머지 WAITING 스텝 취소
        await tx.scheduleApprovalStep.updateMany({
          where: { scheduleRequestId: id, status: "WAITING" },
          data: { status: "REJECTED" },
        });
        emailAction = "reject";
      } else {
        // 승인: 다음 WAITING 스텝을 PENDING으로
        const nextStep = steps.find(
          (s) => s.order === myStep!.order + 1 && s.status === "WAITING"
        );
        if (nextStep) {
          await tx.scheduleApprovalStep.update({
            where: { id: nextStep.id },
            data: { status: "PENDING" },
          });
          emailAction = "next_approver";
          nextApprover = nextStep.approver;
          // ⚠ 알림은 **트랜잭션이 끝난 뒤** 보낸다(아래). 여기서 보내면 트랜잭션이
          //   롤백돼도 "결재 요청이 도착했습니다" DM 은 이미 나가 있다
          //   (2026-09-09 검증에서 적발).
          notifyNext = nextStep;
          // 아직 다음 결재자가 있으면 전체 상태는 PENDING 유지
        } else {
          // 모든 단계 승인 완료 → 전체 승인
          await tx.scheduleRequest.update({
            where: { id },
            data: { status: "APPROVED" },
          });
          // 승인된 일정을 근무일정 캘린더에 반영
          await materializeSchedules(tx, scheduleRequest);
          emailAction = "approve";
        }
      }
    });

    if (alreadyDone) {
      return NextResponse.json({ error: "이미 처리된 결재입니다." }, { status: 409 });
    }

    // 트랜잭션이 실제로 커밋된 뒤에 알린다
    if (notifyNext) {
      botNotifyApprovalRequest(notifyNext, {
        kind: "근무일정",
        requesterName: scheduleRequest.user.name,
        period: fmtRange(scheduleRequest.startDate, scheduleRequest.endDate),
        requesterId: scheduleRequest.userId,
      }).catch(() => {});
    }

    // 이메일 발송 (실제로는 여기서 이메일을 보내면 됨)
    // 현재는 로그만 기록
    console.log("이메일 발송:", { emailAction, nextApprover });

    await logAudit({
      actorId: session.userId, actorName: session.name, action: "SCHEDULE_DECISION",
      targetType: "SCHEDULE", targetId: id, targetName: scheduleRequest.user.name,
      detail: `${scheduleRequest.user.name} 근무일정 ${action === "approve" ? "승인" : "반려"}`,
    });

    // 최종 결정 시 신청자에게 봇 DM
    if (emailAction === "approve" || emailAction === "reject") {
      botNotifyDecision(
        scheduleRequest.userId,
        `근무일정 (${fmtRange(scheduleRequest.startDate, scheduleRequest.endDate)})`,
        emailAction === "approve",
        session.name,
        reason
      ).catch(() => {});
    }

    return NextResponse.json({ success: true });
  }

  // 결재라인 없음: 관리자만 처리한다(주석대로 "관리자만" — 종전에는 원장도 통과했다).
  if (session.role !== "ADMIN") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  return await adminOverride(id, action, reason, session.userId);
}

// 관리자 직접 승인/반려
async function adminOverride(
  id: string,
  action: string,
  reason: string | undefined,
  approverId: string
) {
  const scheduleRequest = await prisma.scheduleRequest.findUnique({
    where: { id },
    include: { user: { select: { name: true } } },
  });

  if (!scheduleRequest) {
    return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });
  }

  // ⚠ 이미 끝난 신청은 뒤집지 않는다. 종전에는 최종 상태 검사가 없어
  //   **반려된 신청을 승인으로 되살릴 수 있었고**, 반대로 승인을 반려로 바꿔도
  //   이미 만들어진 근무일정은 그대로 남아 "반려됐는데 주말 출근은 가능"한 상태가
  //   됐다(2026-09-08 검증에서 적발).
  if (scheduleRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: `이미 ${scheduleRequest.status === "APPROVED" ? "승인" : "처리"}된 신청입니다.` },
      { status: 409 }
    );
  }

  // ⚠ **먼저 잡는 쪽만 처리한다.** 무조건 update 하면 관리자 둘이 동시에(또는 한 명이
  //   더블클릭) 처리할 때 감사로그.봇DM 이 두 번 나가고, 승인.반려가 엇갈리면 마지막
  //   쓰기가 이긴다. 휴가에는 넣고 근무일정만 빠뜨렸었다(2026-09-09 검증에서 적발).
  let claimed = false;
  await prisma.$transaction(async (tx) => {
    const won = await tx.scheduleRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: action === "approve" ? "APPROVED" : "REJECTED" },
    });
    if (won.count === 0) return;
    claimed = true;
    // 결재 단계도 함께 닫는다. 종전에는 신청만 바꿔서 **신청=승인인데 단계=대기**로
    // 남았고, 그 단계가 결재함에 영원히 떠 있다가 나중에 처리되면 일정이 두 번 생겼다.
    await tx.scheduleApprovalStep.updateMany({
      where: { scheduleRequestId: id, status: { in: ["PENDING", "WAITING"] } },
      data: {
        status: action === "approve" ? "APPROVED" : "REJECTED",
        approverId,
        comment: reason ?? "관리자 직접처리",
        decidedAt: new Date(),
      },
    });
    // 승인된 일정을 근무일정 캘린더에 반영
    if (action === "approve") {
      await materializeSchedules(tx, scheduleRequest);
    }
  });

  if (!claimed) {
    return NextResponse.json({ error: "이미 처리된 신청입니다." }, { status: 409 });
  }

  const actor = await prisma.user.findUnique({ where: { id: approverId }, select: { name: true } });
  await logAudit({
    actorId: approverId, actorName: actor?.name ?? "관리자", action: "SCHEDULE_DECISION",
    targetType: "SCHEDULE", targetId: id, targetName: scheduleRequest.user.name,
    detail: `${scheduleRequest.user.name} 근무일정 ${action === "approve" ? "승인" : "반려"} (직접처리)`,
  });

  // 신청자에게 봇 DM
  botNotifyDecision(
    scheduleRequest.userId,
    `근무일정 (${fmtRange(scheduleRequest.startDate, scheduleRequest.endDate)})`,
    action === "approve",
    actor?.name ?? "관리자",
    reason
  ).catch(() => {});

  return NextResponse.json({ success: true });
}
