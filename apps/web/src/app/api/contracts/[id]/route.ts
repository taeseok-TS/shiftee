import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppUrl, approvalPageUrl } from "@/lib/app-url";
import { hrBotSendDM } from "@/lib/bot";
import { logAudit } from "@/lib/audit";
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
      template: { select: { postSignAccess: true } }, // 서명 완료 후 근로자 접근 (#129)
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

  const { template, ...rest } = contract;
  // 목록 API 와 같은 규칙 — 열람 금지 문서는 서명을 마친 뒤 파일 주소를 감춘다
  const access = template?.postSignAccess || "full";
  const hideFiles =
    session.role !== "ADMIN" && access === "none" &&
    (rest as { userId?: string }).userId === session.userId &&
    !!(rest as { employeeSignedAt?: Date | null }).employeeSignedAt;
  // 남의 결재 서명 이미지 주소는 주지 않는다 — 서명 PNG 는 완료본에 찍히는 도장이라
  // 위조 재료가 된다. 목록 API 는 이미 가리고 있었는데 상세만 빠져 두 문이 어긋났다.
  const line = (rest as { approvalLine?: { steps?: { approverId: string | null; signatureUrl: string | null }[] } }).approvalLine;
  const safeLine = line?.steps
    ? {
        ...line,
        steps: line.steps.map((st) => ({
          ...st,
          signatureUrl: session.role === "ADMIN" || st.approverId === session.userId ? st.signatureUrl : null,
        })),
      }
    : line;
  return NextResponse.json({
    contract: {
      ...rest,
      ...(safeLine ? { approvalLine: safeLine } : {}),
      ...(hideFiles ? { fileUrl: null, signedUrl: null } : {}),
      postSignAccess: access,
    },
  });
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
    select: { status: true, version: true, title: true, type: true, fileUrl: true, startDate: true, endDate: true, userId: true, templateId: true, externalName: true, externalPhone: true, extraFields: true },
  });

  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  // ⚠ status 를 검증 없이 받으면 `PATCH {status:"SENT"}` 한 번으로 반려가 풀린다. 같은 파일이
  //   type 은 asContractType 으로 검증하면서 status 는 안 했다(2026-09-04 검증관 F3).
  //   반려는 **최종 상태**다(디렉터 결정) — 다시 하려면 계약을 새로 만들어야 한다.
  //   두 방향을 다 막는다: 반려로 바꾸는 것도(그건 /reject 의 일이다), 반려를 푸는 것도.
  if (status && !["DRAFT", "SENT", "APPROVED", "SIGNED", "EXPIRED"].includes(status))
    return NextResponse.json({ error: "알 수 없는 계약 상태입니다." }, { status: 400 });
  if (contract.status === "REJECTED")
    return NextResponse.json(
      { error: "반려된 계약은 수정할 수 없습니다. 계약을 새로 만들어 발송해주세요." },
      { status: 400 }
    );

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

  // 발송 시 최신 템플릿으로 문서 재생성 (#163, 2026-08-27 디렉터 확정)
  // 계약서는 "작성 시점"에 워드로 굳는다 — 그 뒤 템플릿(양식)을 고쳐도 이미 만들어 둔 초안은
  // 옛 양식 그대로 서명·보존됐다. 발송이 곧 계약 문서 확정 시점이므로, 이때 최신 양식으로
  // 다시 렌더한다. 입력값(extraFields·기간·연봉)은 그대로 쓰므로 내용은 바뀌지 않는다.
  // 이미 발송된 건의 재발송에도 적용된다(결재선이 초기화되어 처음부터 다시 받으므로 동일 기준).
  let sendRenderUrl: string | null = null;
  if (status === "SENT" && contract.templateId && !newFileUrl) {
    try {
      const tmpl = await prisma.contractTemplate.findUnique({
        where: { id: contract.templateId }, select: { fileUrl: true },
      });
      if (tmpl?.fileUrl.toLowerCase().endsWith(".docx")) {
        const prevExtra = (contract.extraFields as Record<string, string>) || {};
        const mergeData = await buildContractMergeData(contract.userId, {
          title: title || contract.title,
          startDate: startDate ? new Date(startDate).toISOString() : (contract.startDate ? contract.startDate.toISOString() : null),
          endDate: endDate ? new Date(endDate).toISOString() : (contract.endDate ? contract.endDate.toISOString() : null),
          salary: ((prevExtra["연봉"] || "").replace(/[^0-9]/g, "")) || null,
          extraFields: prevExtra,
          external: contract.externalName ? { name: contract.externalName, phone: contract.externalPhone } : null,
        });
        sendRenderUrl = await fillDocxTemplate(tmpl.fileUrl, mergeData);
      }
    } catch (e) {
      // 재렌더 실패해도 발송 자체는 막지 않는다(기존 문서로 진행)
      console.error("발송 시 문서 재생성 오류(기존 문서로 진행):", e);
    }
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
      ...(newFileUrl ? { fileUrl: newFileUrl } : sendRenderUrl ? { fileUrl: JSON.stringify([sendRenderUrl]) } : {}),
      // 발송(재발송 포함)이면 결재선이 초기화되어 서명이 전부 사라진다. 그런데 저장된 완료본과
      // 직원 서명 시각이 남아 있으면 ① 미리보기 폴백이 **옛 완료본**을 되살리고
      // ② 직원 화면이 "서명했다"로 판단해 완료본 링크를 열었다가 400 오류를 본다 (2026-09-04).
      ...(status === "SENT" ? { signedUrl: null, signedAt: null, employeeSignedAt: null } : {}),
      ...(fieldSummary ? { extraFields: fieldSummary } : {}),
    },
    include: {
      user: { select: { id: true, name: true, email: true, department: true } },
      approvalLine: {
        include: {
          steps: { include: { approver: { select: { id: true, name: true, email: true, role: true } } } },
        },
      },
    },
  });

  // 외부 계약 발송 → 결재선의 내부 결재자들에게 큐브티워크 봇 DM 으로 서명 링크 전달.
  // 발송자는 PC 앞이어도, 문자를 실제로 보낼 현장 관리자는 폰을 들고 있다 —
  // 채팅의 문자 중계 링크(https)를 탭하면 문자 앱이 번호·본문 채워진 채 열린다.
  if (status === "SENT" && contract.externalName) {
    const extStep = updated.approvalLine?.steps.find(s => !s.approverId && s.signToken);
    // 결재선에 내부 결재자가 없으면(신청서·동의서처럼 외부인 서명만 받는 경우)
    // 발송자 본인에게 중계 링크 DM — 채용 패키지 외 문서도 같은 경로로 문자 전달 가능
    // (개선 제안 2026-08-24: 출산휴가원 등 신청서도 채팅봇 연결)
    const stepApproverIds = (updated.approvalLine?.steps || [])
      .map(s => s.approverId)
      .filter((v): v is string => !!v);
    const internalIds = stepApproverIds.length > 0 ? stepApproverIds : [session.userId];
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
      for (const uid of internalIds) await hrBotSendDM(uid, msg);
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
          appUrl,
          updated.user.id // 본인 확인 관문(#140) — 빠뜨리면 옛 링크(/contracts)로 나가 남의 세션으로 열린다
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
          appUrl,
          firstPendingStep.approverId || undefined
        );
      }
    }

    // 신청서·계약서 발송 봇 DM (개선 제안 2026-08-24) — 이메일과 별개로 큐브티워크로도 알린다.
    // 외부 서명 단계(approverId 없음)는 위의 문자 중계 DM이 담당.
    if (firstPendingStep?.approverId) {
      // 외부 계약의 userId 는 작성 관리자 — 직원 서명 문구가 아니라 결재 요청 문구여야 한다
      const isEmployee = firstPendingStep.approverId === updated.userId && !contract.externalName;
      const dm = isEmployee
        ? `\ud83d\udcdd 전자계약 서명 요청\n「${updated.title}」\n앱 하단 [전자계약]에서 내용 확인 후 서명해 주세요.\n웹에서 바로 서명: ${appUrl}/contracts`
        : `\ud83d\udd8b 전자계약 결재 요청\n「${updated.title}」 — 대상: ${contract.externalName || updated.user.name}\n아래 링크에서 바로 처리할 수 있습니다:\n${appUrl}${approvalPageUrl((firstPendingStep as { approver?: { role?: string } }).approver?.role)}`;
      hrBotSendDM(firstPendingStep.approverId, dm).catch((e) => console.error("[contract] 발송 DM 오류:", e));
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
    select: {
      id: true, status: true, title: true, bundleId: true,
      externalName: true, user: { select: { name: true } },
    },
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

  // 하드 삭제라 지운 뒤에는 무엇이 있었는지 알 길이 없다 — 감사 로그가 유일한 흔적.
  // (2026-08-19 계약 전체가 비었을 때 누가 지웠는지 추적 불가했던 사고의 재발 방지)
  const targetName = contract.externalName
    ? `${contract.externalName}(외부)`
    : contract.user?.name || "-";
  await logAudit({
    actorId: session.userId,
    actorName: session.name,
    action: "CONTRACT_DELETE",
    targetType: "Contract",
    targetId: id,
    targetName,
    detail:
      contract.bundleId && targetIds.length > 1
        ? `${targetName} — "${contract.title}" 포함 패키지 ${targetIds.length}종 삭제`
        : `${targetName} — "${contract.title}" 삭제`,
  });

  return NextResponse.json({
    success: true,
    message: contract.bundleId && targetIds.length > 1
      ? `패키지 문서 ${targetIds.length}종이 함께 삭제되었습니다.`
      : `"${contract.title}" 계약서가 삭제되었습니다.`,
  });
}