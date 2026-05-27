import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendContractNotification } from "@/lib/email";
import type { Contract } from "@shiftee/api";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true, department: true, branch: true } },
      approvalLine: {
        include: {
          steps: {
            include: { approver: { select: { id: true, name: true, branch: true } } },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });

  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  if (session.role !== "ADMIN" && session.userId !== contract.userId)
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  return NextResponse.json({ contract });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role === "EMPLOYEE")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  const { status, title, type, startDate, endDate, approverIds } = body;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { status: true, version: true, title: true, type: true, fileUrl: true, startDate: true, endDate: true },
  });

  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  // 계약서 내용이 변경되면 버전 저장 (title, type, startDate, endDate 중 하나라도 변경)
  const hasContentChanges = title || type || startDate || endDate;
  if (hasContentChanges && contract.version) {
    // 현재 상태를 버전으로 저장
    await prisma.contractVersion.create({
      data: {
        contractId: id,
        version: contract.version,
        fileUrl: contract.fileUrl,
        title: contract.title,
        type: contract.type as any,
        status: contract.status as any,
        startDate: contract.startDate,
        endDate: contract.endDate,
        createdBy: session.userId,
      },
    });

    // 버전 증가
    await prisma.contract.update({
      where: { id },
      data: { version: { increment: 1 } },
    });
  }

  // 발송(SENT) 상태로 변경 시 또는 승인라인을 추가/업데이트할 때
  if ((status === "SENT" || approverIds) && approverIds && approverIds.length > 0) {
    // 기존 승인라인 제거
    await prisma.contractApprovalLine.deleteMany({ where: { contractId: id } });

    // 새 승인라인 생성
    const approvalLine = await prisma.contractApprovalLine.create({
      data: {
        contractId: id,
        steps: {
          createMany: {
            data: approverIds.map((approverId: string, idx: number) => ({
              approverId,
              order: idx + 1,
              status: "WAITING",
            })),
          },
        },
      },
    });
  }

  const updated = await prisma.contract.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(title ? { title } : {}),
      ...(type ? { type } : {}),
      ...(startDate ? { startDate: new Date(startDate) } : {}),
      ...(endDate ? { endDate: new Date(endDate) } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true, department: true } },
      approvalLine: {
        include: {
          steps: { include: { approver: { select: { name: true } } } },
        },
      },
    },
  });

  // 상태가 SENT로 변경되면 직원에게 알림 이메일 발송
  if (status === "SENT" && updated.user.email) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    await sendContractNotification(
      updated.user.email,
      updated.user.name,
      updated.title,
      appUrl
    );
  }

  return NextResponse.json({ success: true, contract: updated });
}