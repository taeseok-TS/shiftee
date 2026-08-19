import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/app-url";
import { botSendDM } from "@/lib/bot";
import { sendContractNotification, sendApprovalRequest } from "@/lib/email";
import { fillDocxTemplate, buildContractMergeData, buildFieldSummary } from "@/lib/contract-fields";
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
  // 계약서 수정·발송은 관리자 전용 — 원장·직원은 결재 진행 중 내용 변경 불가
  if (!session || session.role !== "ADMIN")
    return NextResponse.json({ error: "계약서 수정은 관리자만 가능합니다." }, { status: 403 });

  const { id } = await params;

  let status, title, type, startDate, endDate, approverIds, hideRevoked;
  let salary: string | null = null;
  let extraFieldsRaw: string | null = null;
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
      salary = formData.get("salary") as string | null;
      extraFieldsRaw = formData.get("extraFields") as string | null;

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
      salary = body.salary ?? null;
      extraFieldsRaw = body.extraFields ? JSON.stringify(body.extraFields) : null;
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
    select: { status: true, version: true, title: true, type: true, fileUrl: true, startDate: true, endDate: true, userId: true, templateId: true, externalName: true, externalPhone: true },
  });

  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  // 연봉·템플릿 동적 필드 수정: 요약 갱신 + (템플릿 기반 계약이면) 문서를 새 값으로 재생성
  let parsedExtra: Record<string, string> | null = null;
  if (extraFieldsRaw) {
    try { parsedExtra = JSON.parse(extraFieldsRaw); } catch { /* 무시 */ }
  }
  let fieldSummary: Record<string, string> | undefined;
  if (salary !== null || parsedExtra) {
    fieldSummary = buildFieldSummary(salary, parsedExtra);
    if (contract.templateId && !newFileUrl) {
      const tmpl = await prisma.contractTemplate.findUnique({
        where: { id: contract.templateId },
        select: { fileUrl: true },
      });
      if (tmpl?.fileUrl.toLowerCase().endsWith(".docx")) {
        try {
          const mergeData = await buildContractMergeData(contract.userId, {
            title: (title as string) || contract.title,
            startDate: (startDate as string) || (contract.startDate ? contract.startDate.toISOString() : null),
            endDate: (endDate as string) || (contract.endDate ? contract.endDate.toISOString() : null),
            salary,
            extraFields: parsedExtra,
            // 외부 계약은 소유자가 작성 관리자 — external 미전달 시 관리자 개인정보가 문서에 박힘
            external: contract.externalName ? { name: contract.externalName, phone: contract.externalPhone } : null,
          });
          newFileUrl = JSON.stringify([await fillDocxTemplate(tmpl.fileUrl, mergeData)]);
        } catch (e) {
          console.error("계약서 재생성 오류:", e);
        }
      }
    }
  }

  // 계약서 내용이 변경되면 버전 저장 (title, type, startDate, endDate, 입력 필드 중 하나라도 변경)
  const hasContentChanges = title || type || startDate || endDate || salary !== null || parsedExtra;
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

    // "EXTERNAL" 단계는 외부 계약(externalName 있는 계약)에서만 허용 —
    // 일반 직원 계약에 로그인 없는 서명 링크가 생기는 것 방지
    if (approverIds.includes("EXTERNAL") && !contract.externalName) {
      return NextResponse.json({ error: "외부 서명 단계는 외부 계약자 계약에서만 사용할 수 있습니다." }, { status: 400 });
    }
    if (approverIds.filter((a: string) => a === "EXTERNAL").length > 1) {
      return NextResponse.json({ error: "외부 서명 단계는 하나만 넣을 수 있습니다." }, { status: 400 });
    }

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
              if (approverId === "EXTERNAL") {
                // 외부(미가입) 서명자 단계 — 링크 토큰으로 서명 (유효기간 14일)
                return {
                  approverId: null,
                  externalName: contract.externalName || "외부 서명자",
                  signToken: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""),
                  tokenExpiresAt: new Date(Date.now() + 14 * 24 * 3600 * 1000),
                  order: idx + 1,
                  status: stepStatus,
                };
              }
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
      ...(fieldSummary ? { extraFields: fieldSummary } : {}),
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

  // 외부 계약 발송 → 결재선의 내부 결재자들에게 큐브티워크 봇 DM 으로 서명 링크 전달.
  // 발송자는 PC 앞이어도, 문자를 실제로 보낼 현장 관리자는 폰을 들고 있다 —
  // 채팅의 문자 중계 링크(https)를 탭하면 문자 앱이 번호·본문 채워진 채 열린다.
  if (status === "SENT" && contract.externalName) {
    const extStep = updated.approvalLine?.steps.find(s => !s.approverId && s.signToken);
    const internalIds = (updated.approvalLine?.steps || [])
      .map(s => s.approverId)
      .filter((v): v is string => !!v);
    if (extStep?.signToken && internalIds.length > 0) {
      const base = getAppUrl();
      const msg = [
        `📩 외부 계약 발송 — ${contract.externalName} 님${contract.externalPhone ? ` (${contract.externalPhone})` : ""}`,
        `「${updated.title}」`,
        ``,
        `아래 링크를 누르면 문자 앱이 열립니다(내용 자동 입력, 보내기만 누르면 됨):`,
        `${base}/sms-relay/${extStep.signToken}`,
        ``,
        `서명 링크만 직접 전달하려면:`,
        `${base}/sign/${extStep.signToken}`,
      ].join("\n");
      for (const uid of internalIds) await botSendDM(uid, msg);
    }
  }

  // 상태가 SENT로 변경되면 첫 번째 승인 단계의 담당자에게 알림 이메일 발송
  if (status === "SENT") {
    const appUrl = getAppUrl();

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
    select: { id: true, status: true, title: true, bundleId: true },
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

  // 패키지(묶음) 문서면 세트 전체를 함께 삭제 — 완료(SIGNED)된 문서만 보존
  const targetIds = contract.bundleId
    ? (await prisma.contract.findMany({
        where: { bundleId: contract.bundleId, status: { not: "SIGNED" } },
        select: { id: true },
      })).map((c) => c.id)
    : [id];

  // 트랜잭션으로 계약서 및 관련 데이터 삭제
  await prisma.$transaction(async (tx) => {
    // 1. 결재 라인 삭제 (cascade로 steps도 자동 삭제)
    await tx.contractApprovalLine.deleteMany({
      where: { contractId: { in: targetIds } },
    });

    // 2. 버전 히스토리 삭제
    await tx.contractVersion.deleteMany({
      where: { contractId: { in: targetIds } },
    });

    // 3. 계약서 삭제
    await tx.contract.deleteMany({
      where: { id: { in: targetIds } },
    });
  });

  return NextResponse.json({
    success: true,
    message: contract.bundleId && targetIds.length > 1
      ? `패키지 문서 ${targetIds.length}종이 함께 삭제되었습니다.`
      : `"${contract.title}" 계약서가 삭제되었습니다.`,
  });
}