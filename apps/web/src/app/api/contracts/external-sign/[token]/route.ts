import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

// 외부(미가입) 계약자 게스트 서명 — 로그인 없이 서명 링크 토큰으로 인증
// 토큰은 발송 시 생성(64자 랜덤, 14일 유효), 해당 단계가 자기 차례(PENDING)일 때만 서명 가능
// 패키지(bundleId): 대표 문서 링크 하나로 동반 문서(비밀유지·개인정보동의서)까지 함께 서명

async function findStepByToken(token: string) {
  if (!token || token.length < 32) return null;
  return prisma.contractApprovalStep.findUnique({
    where: { signToken: token },
    include: {
      approvalLine: {
        include: {
          contract: { select: { id: true, title: true, fileUrl: true, status: true, externalName: true, externalPhone: true, signedUrl: true, bundleId: true, userId: true, createdBy: true } },
          steps: { orderBy: { order: "asc" } },
        },
      },
    },
  });
}

function firstFileUrl(fileUrl: string): string | null {
  try {
    const a = JSON.parse(fileUrl);
    return Array.isArray(a) ? (a[0] ?? null) : fileUrl;
  } catch { return fileUrl; }
}

// 패키지 동반 문서(외부인 서명만) — 대표 문서와 함께 게스트가 서명
async function findBundleSiblings(bundleId: string | null, excludeId: string) {
  if (!bundleId) return [];
  return prisma.contract.findMany({
    where: { bundleId, id: { not: excludeId }, employeeOnly: true, externalName: { not: null } },
    select: {
      id: true, title: true, fileUrl: true, status: true, templateId: true,
      extraFields: true, userId: true, externalName: true, externalPhone: true,
      approvalLine: { select: { steps: { orderBy: { order: "asc" } } } },
    },
    orderBy: { createdAt: "asc" },
  });
}

// 서명 페이지 초기 정보 — 계약 제목·문서·현재 상태 (+패키지 동반 문서)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const step = await findStepByToken(token);
  if (!step) return NextResponse.json({ error: "유효하지 않은 서명 링크입니다." }, { status: 404 });

  const contract = step.approvalLine.contract;
  const expired = step.tokenExpiresAt ? step.tokenExpiresAt < new Date() : false;
  const state = step.status === "APPROVED"
    ? "done"
    // ⚠ ContractStatus 에는 REJECTED 가 없다(DRAFT/SENT/APPROVED/SIGNED/EXPIRED).
    //   `contract.status === "REJECTED"` 는 **항상 거짓**인 죽은 비교였다 — 반려 상태는
    //   단계(step)에만 있다. 반려 기능 자체가 아직 없다(검증관 A I1).
    : step.status === "REJECTED"
    ? "rejected"
    : expired
    ? "expired"
    : step.status === "PENDING"
    ? "ready"
    : "waiting"; // 앞 단계 결재 대기 중

  // 문서는 서명 차례(ready)일 때만 노출 — 만료·완료 후 링크 유출로 계약서가 무기한 공개되는 것 방지
  const ready = state === "ready";
  const siblings = await findBundleSiblings(contract.bundleId, contract.id);
  const documents = ready
    ? [
        { title: contract.title, fileUrl: firstFileUrl(contract.fileUrl) },
        ...siblings
          .filter((s) => s.status !== "SIGNED")
          .map((s) => ({ title: s.title, fileUrl: firstFileUrl(s.fileUrl) })),
      ]
    : [];

  // 게스트는 세션이 없으므로 파일 접근 티켓을 함께 발급 — 뷰어가 문서를 열 때 ?t= 로 사용.
  // uploads 게이트(contracts/)와 세트 (2026-08-24)
  const { issueUploadTicket } = await import("@/lib/upload-ticket");

  return NextResponse.json({
    title: contract.title,
    externalName: step.externalName,
    fileUrl: ready ? firstFileUrl(contract.fileUrl) : null,
    documents,
    // 게스트는 로그인이 없다 — 이 계약 파일에만 통하는 티켓을 준다 (2026-09-02)
      fileTicket: ready ? issueUploadTicket(`c:${contract.id}`, 2 * 3600 * 1000) : null,
    // 개인정보동의서가 포함된 패키지면 게스트가 선택 항목 동의/미동의 선택 가능
    consentDoc: ready && siblings.some((s) => s.status !== "SIGNED" && s.title.includes("개인정보")),
    state,
  });
}

// 게스트 서명 제출 — 대표 문서 단계 승인 + 패키지 동반 문서 일괄 서명
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const step = await findStepByToken(token);
  if (!step) return NextResponse.json({ error: "유효하지 않은 서명 링크입니다." }, { status: 404 });
  // 사내 직원으로 재배정된 스텝은 토큰 서명 불가(승인자 변경 후 잔존 토큰 방어)
  if (step.approverId !== null)
    return NextResponse.json({ error: "유효하지 않은 서명 링크입니다." }, { status: 404 });
  if (step.status === "APPROVED")
    return NextResponse.json({ error: "이미 서명이 완료된 계약서입니다." }, { status: 400 });
  if (step.tokenExpiresAt && step.tokenExpiresAt < new Date())
    return NextResponse.json({ error: "서명 링크가 만료되었습니다. 담당자에게 재발급을 요청해주세요." }, { status: 400 });
  if (step.status !== "PENDING")
    return NextResponse.json({ error: "아직 서명 차례가 아닙니다. 앞 단계 결재가 끝나면 서명할 수 있습니다." }, { status: 400 });

  const { signatureData, consent } = (await request.json().catch(() => ({}))) as {
    signatureData?: string;
    consent?: Record<string, string> | null; // 개인정보동의서 선택 항목 (동의고유식별/동의채용정보)
  };
  const m = /^data:image\/png;base64,(.+)$/.exec(signatureData || "");
  if (!m) return NextResponse.json({ error: "서명을 입력해주세요." }, { status: 400 });

  // 서명 이미지 저장
  const buffer = Buffer.from(m[1], "base64");
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-ext-sign.png`;
  const dir = path.join(process.cwd(), "uploads", "signatures");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
  const signatureUrl = `/api/uploads/signatures/${filename}`;

  const contract = step.approvalLine.contract;
  const contractId = contract.id;
  const steps = step.approvalLine.steps;

  // 단계 승인 처리 + 다음 단계 진행 (기존 사내 결재와 동일한 흐름)
  await prisma.contractApprovalStep.update({
    where: { id: step.id },
    data: { status: "APPROVED", decidedAt: new Date(), signatureUrl },
  });
  const nextStep = steps.find((s) => s.order === step.order + 1);
  // 발송 작성자(createdBy, 없으면 외부 계약 소유자=작성 관리자)에게 서명 진행 알림
  // (개선 제안 2026-08-25, 이예지대리). 마지막 단계면 아래 완료 알림이 대신한다 (#136)
  if (nextStep) {
    const { hrBotSendDM } = await import("@/lib/bot");
    const { getAppUrl } = await import("@/lib/app-url");
    const { contractPageLink } = await import("@/lib/contract-notify");
    // 알림에는 항상 해당 화면 바로가기를 넣는다 (#167)
    const creatorId = contract.createdBy || contract.userId;
    const creatorRole = (await prisma.user.findUnique({ where: { id: creatorId }, select: { role: true } }))?.role;
    hrBotSendDM(
      creatorId,
      `✍️ 외부 계약자 서명 완료\n「${contract.title}」 — ${contract.externalName || "외부 계약자"} 님이 서명했습니다.\n확인: ${getAppUrl()}${contractPageLink(creatorRole)}`
    ).catch((e) => console.error("[external-sign] 작성자 알림 오류:", e));
    await prisma.contractApprovalStep.update({ where: { id: nextStep.id }, data: { status: "PENDING" } });
    // 다음 내부 결재자에게 차례 알림 — 이 경로에만 빠져 있어 2단계 결재자가
    // 자기 차례를 모르는 문제가 있었다 (QA 2026-08-25, 이예지대리)
    if (nextStep.approverId) {
      const { hrBotSendDM } = await import("@/lib/bot");
      const { getAppUrl, approvalPageUrl } = await import("@/lib/app-url");
      const contractRow = step.approvalLine.contract;
      // 원장은 /admin 접근이 막혀 있어 역할별 결재함 경로로 안내 (검증관 지적)
      const approverRole = (await prisma.user.findUnique({ where: { id: nextStep.approverId }, select: { role: true } }))?.role;
      hrBotSendDM(
        nextStep.approverId,
        `🖋 전자계약 결재 요청\n「${contractRow.title}」 — 대상: ${contractRow.externalName || "외부 계약자"}\n외부 계약자의 서명이 완료되어 결재 차례가 되었습니다.\n아래 링크에서 바로 처리할 수 있습니다:\n${getAppUrl()}${approvalPageUrl(approverRole)}`
      ).catch((e) => console.error("[external-sign] 결재 DM 오류:", e));
    }
  }
  await prisma.contract.update({
    where: { id: contractId },
    data: {
      employeeSignedAt: new Date(), // 외부 계약자 = 근로자 서명
      status: !nextStep ? "SIGNED" : "APPROVED",
      signedAt: !nextStep ? new Date() : undefined,
    },
  });

  // 마지막 단계면 서명 완료본(서명+직인 포함) 생성 + 완료 알림 (#136)
  if (!nextStep) {
    try {
      const { generateAndStoreSignedDoc } = await import("@/lib/signed-doc");
      await generateAndStoreSignedDoc(contractId);
    } catch (e) { console.error("외부 서명 완료본 생성 오류:", e); }
    // 전체 완료 — 작성자 + 결재 참여 내부 결재자 전원에게 통지 (외부 계약자는 계정이 없어 DM 없음)
    const { notifyContractCompleted } = await import("@/lib/contract-notify");
    await notifyContractCompleted(contractId);
  }

  // 패키지 동반 문서(비밀유지·개인정보동의서) — 같은 서명으로 함께 완료
  const siblings = await findBundleSiblings(contract.bundleId, contractId);
  const failedDocs: string[] = [];
  for (const sib of siblings) {
    const sibStep = sib.approvalLine?.steps.find((s) => s.approverId === null && s.status === "PENDING");
    if (!sibStep) continue;
    try {
      // 개인정보동의서: 게스트의 선택 동의(동의/미동의)를 반영해 문서 재생성 후 서명.
      // 재생성 실패 시 이 문서는 서명하지 않는다 — 게스트의 미동의 의사와 반대인
      // 기본 동의 문서가 SIGNED로 확정되는 것 방지(관리자가 결재 현황에서 확인 후 재전달)
      if (consent && typeof consent === "object" && sib.templateId && sib.title.includes("개인정보")) {
        const tmpl = await prisma.contractTemplate.findUnique({
          where: { id: sib.templateId }, select: { fileUrl: true },
        });
        if (tmpl?.fileUrl.toLowerCase().endsWith(".docx")) {
          const { buildContractMergeData, fillDocxTemplate, buildFieldSummary } = await import("@/lib/contract-fields");
          const prevExtra = (sib.extraFields as Record<string, string>) || {};
          const merged = { ...prevExtra, ...consent };
          const mergeData = await buildContractMergeData(sib.userId, {
            title: sib.title,
            startDate: null, endDate: null, salary: null,
            extraFields: merged,
            external: sib.externalName ? { name: sib.externalName, phone: sib.externalPhone } : null,
          });
          const newUrl = await fillDocxTemplate(tmpl.fileUrl, mergeData);
          await prisma.contract.update({
            where: { id: sib.id },
            data: { fileUrl: JSON.stringify([newUrl]), extraFields: buildFieldSummary(null, merged) },
          });
        }
      }
      await prisma.contractApprovalStep.update({
        where: { id: sibStep.id },
        data: { status: "APPROVED", decidedAt: new Date(), signatureUrl },
      });
      await prisma.contract.update({
        where: { id: sib.id },
        data: { status: "SIGNED", employeeSignedAt: new Date(), signedAt: new Date() },
      });
      const { generateAndStoreSignedDoc } = await import("@/lib/signed-doc");
      await generateAndStoreSignedDoc(sib.id);
    } catch (e) {
      console.error("패키지 동반 문서 서명 오류:", sib.title, e);
      failedDocs.push(sib.title);
    }
  }

  return NextResponse.json({
    success: true,
    completed: !nextStep,
    ...(failedDocs.length
      ? { warning: `일부 문서(${failedDocs.map((t) => t.replace(/ - .*$/, "")).join(", ")}) 처리에 실패했습니다. 담당자에게 문의해주세요.` }
      : {}),
  });
}
