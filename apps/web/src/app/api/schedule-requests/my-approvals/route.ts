import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

// 내가 결재해야 하는 근무일정 신청 목록
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const steps = await prisma.scheduleApprovalStep.findMany({
    where: {
      status: "PENDING",
      OR: [
        { approverId: session.userId }, // 레거시 고정 결재자
        ...(session.role === "ADMIN" ? [{ approverRole: "ADMIN" }] : []),
        ...(session.role === "MANAGER" ? [{ approverRole: "MANAGER", branch: { in: myBranches } }] : []),
      ],
    },
    include: {
      scheduleRequest: {
        include: {
          user: { select: { id: true, name: true, department: true, position: true, branch: true } },
          approvalSteps: {
            include: {
              approver: { select: { id: true, name: true, position: true, branch: true } },
            },
            orderBy: { order: "asc" },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // 관리자: 결재라인이 없는 대기 신청 + **담당 원장이 없어 멈춘 신청**도 결재함에 표시.
  // 종전에는 원장 단계에서 멈춘 신청이 관리자 결재함에 뜨지 않아, 그 지점 원장이
  // 퇴사.비활성되면 **아무에게도 보이지 않고 영구 정지**했다(2026-09-08 검증에서 적발).
  if (session.role === "ADMIN") {
    // 활성 원장이 담당하는 지점 목록 — 여기 없는 지점의 MANAGER 단계는 고아 상태다.
    const activeManagers = await prisma.user.findMany({
      where: { role: "MANAGER", isActive: true },
      select: { branch: true, managerBranches: { select: { branchName: true } } },
    });
    const covered = new Set<string>();
    for (const m of activeManagers) {
      if (m.branch) covered.add(m.branch);
      for (const b of m.managerBranches) covered.add(b.branchName);
    }
    const orphanSteps = await prisma.scheduleApprovalStep.findMany({
      where: {
        status: "PENDING",
        approverRole: "MANAGER",
        // 지점이 비어 있는 MANAGER 단계는 **어떤 원장도 매칭되지 않아** 영구 고아다
        // (myStep 판정이 branch 를 요구한다). SQL NOT IN 은 NULL 을 걸러내므로 따로 받는다.
        OR: [{ branch: null }, { branch: { notIn: [...covered] } }],
      },
      include: {
        scheduleRequest: {
          include: {
            user: { select: { id: true, name: true, department: true, position: true, branch: true } },
            approvalSteps: {
              include: { approver: { select: { id: true, name: true, position: true, branch: true } } },
              orderBy: { order: "asc" },
            },
          },
        },
      },
    });
    for (const st of orphanSteps) {
      if (!steps.some((x) => x.id === st.id)) steps.push(st);
    }

    const noLineRequests = await prisma.scheduleRequest.findMany({
      where: {
        status: "PENDING",
        approvalSteps: { none: {} },
      },
      include: {
        user: { select: { id: true, name: true, department: true, position: true, branch: true } },
        approvalSteps: {
          include: {
            approver: { select: { id: true, name: true, position: true, branch: true } },
          },
          orderBy: { order: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const directSteps = noLineRequests.map((req) => ({
      id: `direct-${req.id}`,
      order: 0,
      status: "PENDING",
      scheduleRequest: req,
    }));

    return NextResponse.json({ steps: [...steps, ...directSteps] });
  }

  return NextResponse.json({ steps });
}
