import { NextRequest, NextResponse } from "next/server";
import { botNotifyApprovalRequest } from "@/lib/bot";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isLeaveDeductible } from "@/lib/leave-types";
import { currentLeaveYear } from "@/lib/leave-calc";
import { logAudit } from "@/lib/audit";
import { botNotifyDecision } from "@/lib/bot";
import { getManagerBranches } from "@/lib/manager-branches";

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

  const leaveRequest = await prisma.leaveRequest.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, branch: true } },
      approvalSteps: {
        orderBy: { order: "asc" },
        include: { approver: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!leaveRequest)
    return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });

  // ⚠ 이미 끝난 신청은 어느 경로로도 다시 처리하지 않는다. 종전에는 우회 경로에만
  //   검사가 있어서, **취소된 휴가가 결재함에 남아 있다가 승인되면 되살아나고
  //   연차까지 깎였다**(2026-09-09 검증에서 적발). 근무일정에는 넣고 휴가만 빠뜨렸다.
  if (leaveRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: `이미 ${leaveRequest.status === "APPROVED" ? "승인" : "처리"}된 신청입니다.` },
      { status: 409 }
    );
  }

  const steps = leaveRequest.approvalSteps;

  // ── 결재라인이 있는 경우: 단계별 처리 ──────────────────────
  if (steps.length > 0) {
    // 내가 결재해야 할 PENDING 스텝 찾기
    const myStep = steps.find((s) => {
      if (s.status !== "PENDING") return false;
      // ⚠ 사람을 못박은 단계(메인 원장 지정 등)는 **그 사람만** 결재한다.
      //   이 검사가 아래 역할.지점 검사보다 먼저 와야 한다 — 안 그러면 같은 지점
      //   원장이면 아무나 통과해 못박은 의미가 사라진다.
      if (s.approverId) return s.approverId === session.userId;
      if (s.approverRole === "ADMIN") return session.role === "ADMIN";
      if (s.approverRole === "MANAGER") return session.role === "MANAGER" && !!s.branch && myBranches.includes(s.branch);
      return s.approverId === session.userId;
    });

    // ⚠ **원장은 자기 휴가를 스스로 결재할 수 없다** (2026-09-08 디렉터 지시 — 근무일정과 같은 규칙).
    //   원장 신청의 결재선은 [관리자]인데, 종전에는 아래 우회 경로로 빠져 본인이
    //   본인 것을 최종 승인할 수 있었다. 원장끼리 품앗이도 가능했다.
    if (session.role === "MANAGER" && leaveRequest.userId === session.userId) {
      return NextResponse.json(
        { error: "본인 휴가 신청은 직접 결재할 수 없습니다. 관리자 승인이 필요합니다." },
        { status: 403 }
      );
    }

    // 관리자가 아니고 결재 차례도 아닌 경우
    if (!myStep && session.role === "EMPLOYEE") {
      return NextResponse.json({ error: "결재 권한이 없습니다." }, { status: 403 });
    }

    // 결재 차례가 아닌데 처리하려는 경우 = 결재라인 우회.
    // ⚠ **관리자에게만 허용한다.** 종전에는 원장도 여기로 빠져, 2일 이상 휴가의
    //   [원장 → 관리자] 에서 원장이 1단계를 승인한 뒤 다시 부르면 관리자 단계를
    //   건너뛰고 최종 승인됐다(2026-09-08 검증에서 적발).
    if (!myStep && session.role === "MANAGER") {
      return NextResponse.json(
        { error: "결재 차례가 아닙니다. 관리자 결재가 남아 있습니다." },
        { status: 403 }
      );
    }
    if (!myStep && session.role === "ADMIN") {
      return await adminOverride(id, leaveRequest.userId, leaveRequest.days, action, reason, session.userId, session.role, myBranches);
    }

    // 단계별 처리
    let emailAction: "approve" | "reject" | "next_approver" | null = null;
    let nextApprover: any = null;
    let alreadyDone = false;
    let notifyNext: { approverRole: string | null; branch: string | null; approverId: string | null } | null = null;

    await prisma.$transaction(async (tx) => {
      // ⚠ **조건부로** 쓴다. 종전에는 무조건 update 라, 결재자가 두 번 누르거나 두 사람이
      //   동시에 처리하면 같은 단계가 두 번 처리되고 마지막 단계면 **연차가 두 번 깎였다**
      //   (2026-09-09 검증에서 적발). 근무일정에는 넣고 휴가만 빠뜨렸다.
      //   이 updateMany 가 트랜잭션의 첫 문장이므로, 못 잡았으면 아무것도 쓰지 않은 상태다.
      const claimed = await tx.leaveApprovalStep.updateMany({
        where: { id: myStep!.id, status: "PENDING" },
        data: {
          status:     action === "approve" ? "APPROVED" : "REJECTED",
          approverId: session.userId, // 실제 결재자 기록
          comment:    reason ?? null,
          decidedAt:  new Date(),
        },
      });
      if (claimed.count === 0) { alreadyDone = true; return; }

      if (action === "reject") {
        // 반려: 전체 요청 반려
        await tx.leaveRequest.update({
          where: { id },
          data: {
            status:         "REJECTED",
            approverId:     session.userId,
            rejectedReason: reason ?? null,
          },
        });
        // 나머지 WAITING 스텝 취소
        await tx.leaveApprovalStep.updateMany({
          where: { leaveRequestId: id, status: "WAITING" },
          data:  { status: "REJECTED" },
        });
        emailAction = "reject";
      } else {
        // 승인: 다음 WAITING 스텝을 PENDING으로
        const nextStep = steps.find(
          (s) => s.order === myStep!.order + 1 && s.status === "WAITING"
        );
        if (nextStep) {
          await tx.leaveApprovalStep.update({
            where: { id: nextStep.id },
            data:  { status: "PENDING" },
          });
          emailAction = "next_approver";
          nextApprover = nextStep.approver;
          // 알림은 **트랜잭션이 커밋된 뒤** 보낸다(롤백돼도 DM 은 이미 나가 있으면 안 된다)
          notifyNext = nextStep;
          // 아직 다음 결재자가 있으면 전체 상태는 PENDING 유지
        } else {
          // 모든 단계 승인 완료 → 전체 승인
          await tx.leaveRequest.update({
            where: { id },
            data:  { status: "APPROVED", approverId: session.userId },
          });
          // 잔여 휴가 차감 (연차 차감 유형만 — 대체휴무/특별휴가/민방위/예비군은 미차감)
          if (isLeaveDeductible(leaveRequest.type)) {
            await tx.leaveBalance.upsert({
              where:  { userId_year: { userId: leaveRequest.userId, year: currentLeaveYear() } },
              create: {
                userId:    leaveRequest.userId,
                year:      currentLeaveYear(),
                total:     15,
                used:      leaveRequest.days,
                remaining: 15 - leaveRequest.days,
              },
              update: {
                used:      { increment: leaveRequest.days },
                remaining: { decrement: leaveRequest.days },
              },
            });
          }
          emailAction = "approve";
        }
      }
    });

    if (alreadyDone) {
      return NextResponse.json({ error: "이미 처리된 결재입니다." }, { status: 409 });
    }

    // 다음 결재자에게 차례가 왔음을 알린다
    if (notifyNext) {
      const ymd = (d: Date) => d.toISOString().slice(0, 10);
      botNotifyApprovalRequest(notifyNext, {
        kind: "휴가",
        requesterName: leaveRequest.user.name,
        period: `${ymd(leaveRequest.startDate)} ~ ${ymd(leaveRequest.endDate)}`,
        requesterId: leaveRequest.userId,
      }).catch(() => {});
    }

    // 결과 알림은 **봇 DM 으로 통일**한다(2026-09-10 디렉터 지시). 메일은 걷어냈다 —
    // 같은 내용이 두 경로로 나가면 한쪽만 실패했을 때 무엇이 갔는지 알 수 없다.
    const requesterName = leaveRequest.user.name;
    const approverName = (await prisma.user.findUnique({ where: { id: session.userId } }))?.name || "관리자";
    const leaveTypeLabel: Record<string, string> = {
      ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차",
      QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
      SICK: "병가", PERSONAL: "개인휴가", SPECIAL: "특별휴가",
      COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차",
      CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련",
      MATERNITY: "출산휴가", BEREAVEMENT: "상주휴가",
      FAMILY_EVENT: "경조사", FAMILY_MARRIAGE: "결혼", FAMILY_BIRTH: "출산", FAMILY_BEREAVEMENT: "사망(조사)",
    };
    const leaveTypeStr = leaveTypeLabel[leaveRequest.type] || leaveRequest.type;
    const startDateStr = leaveRequest.startDate ? leaveRequest.startDate.toISOString().split('T')[0] : '';
    const endDateStr = leaveRequest.endDate ? leaveRequest.endDate.toISOString().split('T')[0] : '';

    await logAudit({
      actorId: session.userId, actorName: session.name, action: "LEAVE_DECISION",
      targetType: "LEAVE", targetId: id, targetName: requesterName,
      detail: `${requesterName} ${leaveTypeStr} ${action === "approve" ? "승인" : "반려"}`,
    });

    // 최종 결정(전체 승인/반려) 시 신청자에게 봇 DM (중간 단계 승인은 발송 안 함)
    // (다음 결재자 알림은 위 notifyNext 에서 이미 봇으로 나간다 — 메일이 하던 일을 대신한다)
    if (emailAction === "approve" || emailAction === "reject") {
      botNotifyDecision(
        leaveRequest.userId,
        `${leaveTypeStr} 휴가 (${startDateStr} ~ ${endDateStr})`,
        emailAction === "approve",
        approverName,
        reason
      ).catch(() => {});
    }

    return NextResponse.json({ success: true });
  }

  // ── 결재라인 없음: 관리자만 처리한다(주석대로 "관리자만" — 종전에는 원장도 통과했다) ──
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  return await adminOverride(id, leaveRequest.userId, leaveRequest.days, action, reason, session.userId, session.role, myBranches);
}

// 관리자 직접 승인/반려 (결재라인 우회)
async function adminOverride(
  id: string,
  userId: string,
  days: number,
  action: string,
  reason: string | undefined,
  approverId: string,
  role?: string,
  branches?: string[]
) {
  const leaveRequest = await prisma.leaveRequest.findUnique({
    where: { id },
    include: { user: { select: { id: true, name: true, email: true, branch: true } } },
  });

  if (!leaveRequest) {
    return NextResponse.json({ error: "신청 내역을 찾을 수 없습니다." }, { status: 404 });
  }

  // MANAGER의 담당 지점(대표+겸직) 검증
  if (role === "MANAGER" && (!leaveRequest.user.branch || !(branches ?? []).includes(leaveRequest.user.branch))) {
    return NextResponse.json({ error: "다른 지점 직원의 휴가는 승인할 수 없습니다." }, { status: 403 });
  }

  // ⚠ 이미 끝난 신청은 다시 처리하지 않는다. 종전에는 검사가 없어서 승인된 휴가에
  //   승인을 다시 부르면 **부를 때마다 연차가 또 깎였다**(used += days). 반려를
  //   승인으로 되살리는 것도 됐다. 근무일정 쪽에는 넣고 여기만 빠뜨렸다
  //   (2026-09-09 검증에서 적발).
  if (leaveRequest.status !== "PENDING") {
    return NextResponse.json(
      { error: `이미 ${leaveRequest.status === "APPROVED" ? "승인" : "처리"}된 신청입니다.` },
      { status: 409 }
    );
  }

  // ⚠ 세 가지(단계 마감 · 신청 상태 · 연차 차감)를 **한 트랜잭션 + CAS** 로 묶는다.
  //   종전에는 셋이 따로 실행돼서, 관리자 둘이 동시에(또는 한 명이 더블클릭) 승인하면
  //   둘 다 위 상태 검사를 통과해 **연차가 두 번 깎였다**. 근무일정 쪽은 반영이
  //   upsert 라 멱등인데 휴가의 `used += days` 는 멱등이 아니다
  //   (2026-09-09 검증에서 적발 — 단계별 경로에서 막은 사고가 이 경로에 남아 있었다).
  //   트랜잭션이 없으면 차감만 실패했을 때 "승인됐는데 안 깎임"도 남는다.
  let claimed = false;
  await prisma.$transaction(async (tx) => {
    const won = await tx.leaveRequest.updateMany({
      where: { id, status: "PENDING" },   // 먼저 잡는 쪽만 처리한다
      data: {
        status:         action === "approve" ? "APPROVED" : "REJECTED",
        approverId,
        rejectedReason: action === "reject" ? reason : null,
      },
    });
    if (won.count === 0) return;
    claimed = true;

    // 남아 있는 결재 단계도 함께 닫는다. 안 닫으면 신청=승인인데 단계=대기로 남아
    // 결재함에 영원히 뜨고, 나중에 처리되면 연차가 한 번 더 깎인다.
    await tx.leaveApprovalStep.updateMany({
      where: { leaveRequestId: id, status: { in: ["PENDING", "WAITING"] } },
      data: {
        status: action === "approve" ? "APPROVED" : "REJECTED",
        approverId,
        comment: reason ?? "관리자 직접처리",
        decidedAt: new Date(),
      },
    });

    // 잔여 휴가 차감 (연차 차감 유형만)
    if (action === "approve" && isLeaveDeductible(leaveRequest.type)) {
      await tx.leaveBalance.upsert({
        where:  { userId_year: { userId, year: currentLeaveYear() } },
        create: {
          userId,
          year:      currentLeaveYear(),
          total:     15,
          used:      days,
          remaining: 15 - days,
        },
        update: {
          used:      { increment: days },
          remaining: { decrement: days },
        },
      });
    }
  });

  if (!claimed) {
    return NextResponse.json({ error: "이미 처리된 신청입니다." }, { status: 409 });
  }

  // 결과 알림 — 봇 DM 으로 통일(2026-09-10 디렉터 지시)
  const approver = await prisma.user.findUnique({ where: { id: approverId } });
  const approverName = approver?.name || "관리자";
  const requesterName = leaveRequest.user.name;
  const leaveTypeLabel: Record<string, string> = {
    ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차",
    QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
    SICK: "병가", PERSONAL: "개인휴가", SPECIAL: "특별휴가",
    COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차",
    CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련",
    MATERNITY: "출산휴가", BEREAVEMENT: "상주휴가",
    FAMILY_EVENT: "경조사", FAMILY_MARRIAGE: "결혼", FAMILY_BIRTH: "출산", FAMILY_BEREAVEMENT: "사망(조사)",
  };
  const leaveTypeStr = leaveTypeLabel[leaveRequest.type] || leaveRequest.type;
  const startDateStr = leaveRequest.startDate ? leaveRequest.startDate.toISOString().split('T')[0] : '';
  const endDateStr = leaveRequest.endDate ? leaveRequest.endDate.toISOString().split('T')[0] : '';

  if (action === "approve") {
  } else {
  }

  await logAudit({
    actorId: approverId, actorName: approverName, action: "LEAVE_DECISION",
    targetType: "LEAVE", targetId: id, targetName: requesterName,
    detail: `${requesterName} ${leaveTypeStr} ${action === "approve" ? "승인" : "반려"} (직접처리)`,
  });

  // 신청자에게 봇 DM
  botNotifyDecision(
    userId,
    `${leaveTypeStr} 휴가 (${startDateStr} ~ ${endDateStr})`,
    action === "approve",
    approverName,
    reason
  ).catch(() => {});

  return NextResponse.json({ success: true });
}
