import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendContractNotification, sendApprovalRequest } from "@/lib/email";
import type { Contract } from "@shiftee/api";
import fs from "fs/promises";
import path from "path";

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
            include: { approver: { select: { id: true, name: true, email: true, branch: true } } },
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

  let status, title, type, startDate, endDate, approverIds, hideRevoked;
  let newFileUrl: string | undefined;
  const contentType = request.headers.get("content-type") || "";

  // FormData 처리 (파일 포함)
  if (contentType.includes("multipart/form-data")) {
    try {
      const formData = await request.formData();
      status = formData.get("status") as string | undefined;
      title = formData.get("title") as string | undefined;
      type = formData.get("type") as string | undefined;
      startDate = formData.get("startDate") as string | undefined;
      endDate = formData.get("endDate") as string | undefined;
      approverIds = formData.get("approverIds") as string | undefined;
      hideRevoked = formData.get("hideRevoked") as string | undefined;

      const files = formData.getAll("files") as File[];

      // 파일이 있으면 저장 및 fileUrl 업데이트
      if (files.length > 0) {
        const fileUrls: string[] = [];
        for (const file of files) {
          try {
            const bytes = await file.arrayBuffer();
            const buffer = Buffer.from(bytes);
            const timestamp = Date.now();
            const filename = `${timestamp}-${Math.random().toString(36).substr(2, 9)}-${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
            const dir = path.join(process.cwd(), "uploads", "contracts");
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(path.join(dir, filename), buffer);
            fileUrls.push(`/api/uploads/contracts/${filename}`);
            console.log("파일 저장 성공:", filename);
          } catch (fileError) {
            console.error("파일 저장 중 에러:", fileError);
            throw new Error(`파일 저장 실패: ${file.name}`);
          }
        }
        // fileUrl을 업데이트할 때 사용
        newFileUrl = JSON.stringify(fileUrls);
      }
    } catch (parseError) {
      console.error("FormData 파싱 에러:", parseError);
      return NextResponse.json(
        { success: false, error: "요청 본문을 파싱할 수 없습니다." },
        { status: 400 }
      );
    }
  } else {
    // JSON 처리
    try {
      const body = await request.json();
      status = body.status;
      title = body.title;
      type = body.type;
      startDate = body.startDate;
      endDate = body.endDate;
      approverIds = body.approverIds;
      hideRevoked = body.hideRevoked;
    } catch (parseError) {
      console.error("JSON 파싱 에러:", parseError);
      return NextResponse.json(
        { success: false, error: "요청 본문이 유효한 JSON이 아닙니다." },
        { status: 400 }
      );
    }
  }

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
    // 디버깅 로그
    console.log("=== PATCH 요청 처리 ===");
    console.log("status:", status);
    console.log("approverIds:", approverIds);
    console.log("contractId:", id);

    // 기존 승인라인 제거
    await prisma.contractApprovalLine.deleteMany({ where: { contractId: id } });

    // 새 승인라인 생성 (SENT 상태일 때는 첫 번째 단계를 PENDING으로 설정)
    const approvalLine = await prisma.contractApprovalLine.create({
      data: {
        contractId: id,
        steps: {
          createMany: {
            data: approverIds.map((approverId: string, idx: number) => {
              const stepStatus = status === "SENT" && idx === 0 ? "PENDING" : "WAITING";
              console.log(`단계 ${idx + 1}: approverId=${approverId}, status=${stepStatus}`);
              return {
                approverId,
                order: idx + 1,
                status: stepStatus,
              };
            }),
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
      ...(hideRevoked !== undefined ? { hideRevoked } : {}),
      ...(newFileUrl ? { fileUrl: newFileUrl } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true, department: true } },
      approvalLine: {
        include: {
          steps: { include: { approver: { select: { id: true, name: true, email: true } } } },
        },
      },
    },
  });

  // 상태가 SENT로 변경되면 첫 번째 승인 단계의 담당자에게 알림 이메일 발송
  if (status === "SENT") {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

    // 첫 번째 PENDING 단계 찾기
    const firstPendingStep = updated.approvalLine?.steps.find(s => s.status === "PENDING");

    if (firstPendingStep) {
      // 첫 번째 단계의 담당자가 직원(employee)인지 확인
      if (firstPendingStep.approverId === updated.userId && updated.user.email) {
        // 직원이 첫 번째 승인자인 경우 - 서명 요청 이메일
        console.log(`📧 첫 번째 PENDING 단계가 직원입니다. 직원에게 서명 요청 이메일 발송: ${updated.user.email}`);
        await sendContractNotification(
          updated.user.email,
          updated.user.name,
          updated.title,
          appUrl
        );
      } else if (firstPendingStep.approver?.email) {
        // 직원이 아닌 다른 승인자가 첫 번째인 경우 - 승인 요청 이메일
        console.log(`📧 첫 번째 PENDING 단계가 승인자입니다. 승인자에게 승인 요청 이메일 발송: ${firstPendingStep.approver.email}`);
        await sendApprovalRequest(
          firstPendingStep.approver.email,
          firstPendingStep.approver.name,
          updated.title,
          updated.user.name,
          firstPendingStep.order,
          appUrl
        );
      }
    }
  }

  return NextResponse.json({ success: true, contract: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();

  // 관리자(ADMIN)만 삭제 가능
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "관리자만 계약서를 삭제할 수 있습니다." }, { status: 403 });
  }

  const { id } = await params;

  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, status: true, title: true },
  });

  if (!contract) {
    return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  }

  // 결재 완료(SIGNED) 상태는 삭제 불가
  if (contract.status === "SIGNED") {
    return NextResponse.json(
      { error: "결재 완료된 계약서는 삭제할 수 없습니다." },
      { status: 400 }
    );
  }

  // 트랜잭션으로 계약서 및 관련 데이터 삭제
  await prisma.$transaction(async (tx) => {
    // 1. 결재 라인 삭제 (cascade로 steps도 자동 삭제)
    await tx.contractApprovalLine.deleteMany({
      where: { contractId: id },
    });

    // 2. 버전 히스토리 삭제
    await tx.contractVersion.deleteMany({
      where: { contractId: id },
    });

    // 3. 계약서 삭제
    await tx.contract.delete({
      where: { id },
    });
  });

  return NextResponse.json({
    success: true,
    message: `"${contract.title}" 계약서가 삭제되었습니다.`,
  });
}