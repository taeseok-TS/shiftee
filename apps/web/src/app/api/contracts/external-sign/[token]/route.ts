import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";
import { phoneHint, phoneLast4, issueExternalVerify, checkExternalVerify, tryLast4 } from "@/lib/external-verify";
import { recordContractEvent } from "@/lib/contract-events";
import { SIGN_CONSENT_TEXT } from "@/lib/contract-consent";
import { lockSteps } from "@/lib/contract-reset";

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
          contract: { select: { id: true, title: true, fileUrl: true, status: true, externalName: true, externalPhone: true, signedUrl: true, bundleId: true, userId: true, createdBy: true, version: true } },
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
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const step = await findStepByToken(token);
  if (!step) return NextResponse.json({ error: "유효하지 않은 서명 링크입니다." }, { status: 404 });

  const contract = step.approvalLine.contract;
  const expired = step.tokenExpiresAt ? step.tokenExpiresAt < new Date() : false;
  const state = step.status === "APPROVED"
    ? "done"
    // 반려 기능이 생겼다(2026-09-04). 반려하면 계약과 남은 단계가 함께 REJECTED 가 되므로
    // 게스트 링크도 자동으로 이 화면이 된다. 계약 상태까지 함께 본다 — 단계만 보면
    // 나중에 계약만 반려되는 경로가 생겼을 때 게스트에게 서명 화면이 그대로 뜬다.
    : step.status === "REJECTED" || contract.status === "REJECTED"
    ? "rejected"
    : expired
    ? "expired"
    : step.status === "PENDING"
    ? "ready"
    : "waiting"; // 앞 단계 결재 대기 중

  // 문서는 서명 차례(ready)일 때만 노출 — 만료·완료 후 링크 유출로 계약서가 무기한 공개되는 것 방지
  const ready = state === "ready";
  // 본인 확인(#205-1, 2026-09-11) — 연락처가 등록된 외부 계약은 **뒷자리 4자리를 맞혀야** 문서가 열린다.
  // 링크가 전달 과정에서 다른 사람에게 가면 그 사람이 근로계약서를 열람·서명할 수 있었다(이예지대리 #206-3).
  const needVerify = ready && !!phoneLast4(contract.externalPhone);
  const verified = !needVerify || checkExternalVerify(step.id, request.headers.get("x-sign-verify"));
  const open = ready && verified;
  const siblings = await findBundleSiblings(contract.bundleId, contract.id);
  const documents = open
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
    // 문서 버전 — 서명 제출 때 x-doc-version 으로 되돌려 보낸다(연 뒤 내용이 바뀌었으면 거절, #206 검증 F2)
    version: contract.version,
    title: contract.title,
    externalName: step.externalName,
    fileUrl: open ? firstFileUrl(contract.fileUrl) : null,
    documents,
    // 게스트는 로그인이 없다 — 이 계약 파일에만 통하는 티켓을 준다 (2026-09-02)
      fileTicket: open ? issueUploadTicket(`c:${contract.id}`, 2 * 3600 * 1000) : null,
    // 개인정보동의서가 포함된 패키지면 게스트가 선택 항목 동의/미동의 선택 가능
    consentDoc: open && siblings.some((s) => s.status !== "SIGNED" && s.title.includes("개인정보")),
    state,
    // 본인 확인 전이면 문서 대신 확인 화면 — 안내에는 앞 3자리만(뒷자리를 보여주면 확인이 무의미하다)
    needVerify: needVerify && !verified,
    phoneHint: needVerify && !verified ? phoneHint(contract.externalPhone) : null,
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

  const { signatureData, consent, action, last4, verifyToken, agree } = (await request.json().catch(() => ({}))) as {
    agree?: boolean;      // 전자서명 동의(#205-3)
    signatureData?: string;
    consent?: Record<string, string> | null; // 개인정보동의서 선택 항목 (동의고유식별/동의채용정보)
    action?: string;      // "verify" — 본인 확인만 한다(#205-1)
    last4?: string;       // 등록 연락처 뒷자리 4자리
    verifyToken?: string; // 본인 확인 증표(2시간, 이 링크에만 유효)
  };

  // ── 본인 확인 (#205-1) ── 서명 차례·만료 검사를 통과한 링크에서만. 틀린 시도는 5번에 30분 잠금.
  const extPhone = step.approvalLine.contract.externalPhone;
  // 감사 기록 공통(#205-4) — 외부 계약자는 계정이 없어 이름·단계로 남긴다
  const evBase = {
    contractId: step.approvalLine.contract.id,
    actorName: step.externalName || step.approvalLine.contract.externalName || "외부 계약자",
    stepOrder: step.order,
    request,
  };
  // 열람·본인 확인 성공은 같은 링크에서 10분에 한 번만 남긴다 — 링크를 가진 사람이 반복 호출해 기록을 쌓지 못하게(묶음 ② 검증 1)
  const recordOnce = async (type: "VIEWED" | "VERIFY_OK") => {
    const recent = await prisma.contractEvent.findFirst({
      where: { contractId: evBase.contractId, type, stepOrder: step.order, createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } },
      select: { id: true },
    });
    if (!recent) await recordContractEvent({ ...evBase, type });
  };
  if (action === "verify") {
    if (!phoneLast4(extPhone)) return NextResponse.json({ verifyToken: issueExternalVerify(step.id) }); // 연락처 없는 옛 계약
    // 잠금 확인과 계수를 한 문장으로(잠금 상태는 DB — 재배포에도 유지)
    const r = await tryLast4(step.id, extPhone, String(last4 ?? ""));
    if (r.result === "locked")
      return NextResponse.json({ code: "VERIFY_LOCKED", error: `여러 번 틀렸습니다. ${Math.max(1, Math.ceil((r.until - Date.now()) / 60000))}분 뒤에 다시 시도하거나 담당자에게 문의해 주세요.` }, { status: 429 });
    if (r.result === "wrong") {
      // 틀린 시도만 남긴다(잠긴 뒤 두드리는 요청까지 남기면 기록이 넘친다 — 틀림은 잠금 한 번에 최대 5건)
      await recordContractEvent({ ...evBase, type: "VERIFY_FAIL" });
      return NextResponse.json({ code: "VERIFY_FAILED", error: "연락처 뒷자리가 맞지 않습니다." }, { status: 400 });
    }
    await recordOnce("VERIFY_OK");
    return NextResponse.json({ verifyToken: issueExternalVerify(step.id) });
  }
  if (phoneLast4(extPhone) && !checkExternalVerify(step.id, verifyToken))
    return NextResponse.json({ code: "VERIFY_REQUIRED", error: "본인 확인이 필요합니다. 연락처 뒷자리를 먼저 입력해 주세요." }, { status: 403 });
  // 열람 기록(#205-4) — 게스트 페이지가 문서를 받은 뒤 한 번 알린다(GET 에는 기록을 넣지 않는 규칙)
  if (action === "viewed") {
    await recordOnce("VIEWED");
    return NextResponse.json({ ok: true });
  }
  // 전자서명 동의(#205-3) — 서명 칸 앞에서 명시적으로 체크해야 한다(종전엔 "제출하면 동의로 간주" 안내뿐)
  if (agree !== true)
    return NextResponse.json({ code: "CONSENT_REQUIRED", error: "전자서명 동의에 체크해 주세요." }, { status: 400 });
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
  // 문서 버전 묶기 + 조건부 찜(#206 검증 F2) — 서명 페이지를 연 뒤 내용이 바뀌었거나 결재가 다시 시작됐으면 받지 않는다
  const seenRaw = request.headers.get("x-doc-version");
  if (seenRaw && Number(seenRaw) !== step.approvalLine.contract.version)
    return NextResponse.json({ code: "DOC_CHANGED", error: "서명 페이지를 연 뒤 문서가 수정됐습니다. 페이지를 새로 고쳐 바뀐 내용을 확인한 뒤 다시 서명해 주세요." }, { status: 409 });
  const nextStep = steps.find((s) => s.order === step.order + 1);
  // 서명 확정 — 찜·다음 단계·계약 갱신을 한 트랜잭션으로(#206 검증 D1). 단계 행을 먼저 잠그고 그 안에서 버전을 다시 본다.
  // 찜에는 **링크 토큰까지** 묶는다(D5) — 초기화는 단계 id 를 유지한 채 토큰만 새로 주므로, 옛 링크의 늦은 요청이
  // 다시 대기가 된 단계에 들어가 바뀐 내용에 서명하지 못하게.
  let signFail = null as "DOC_CHANGED" | "STEP_CHANGED" | null;
  await prisma.$transaction(async (tx) => {
    await lockSteps(tx, contractId);
    if (seenRaw) {
      const fresh = await tx.contract.findUnique({ where: { id: contractId }, select: { version: true } });
      if (fresh && Number(seenRaw) !== fresh.version) { signFail = "DOC_CHANGED"; throw new Error(signFail); }
    }
    const claimed = await tx.contractApprovalStep.updateMany({
      where: { id: step.id, status: "PENDING", approverId: null, signToken: token },
      data: { status: "APPROVED", decidedAt: new Date(), signatureUrl },
    });
    if (claimed.count === 0) { signFail = "STEP_CHANGED"; throw new Error(signFail); }
    if (nextStep) {
      const moved = await tx.contractApprovalStep.updateMany({
        where: { id: nextStep.id, status: { in: ["WAITING", "PENDING"] } },
        data: { status: "PENDING" },
      });
      if (moved.count === 0) { signFail = "STEP_CHANGED"; throw new Error(signFail); }
    }
    await tx.contract.update({
      where: { id: contractId },
      data: {
        employeeSignedAt: new Date(), // 외부 계약자 = 근로자 서명
        status: !nextStep ? "SIGNED" : "APPROVED",
        signedAt: !nextStep ? new Date() : undefined,
      },
    });
  }).catch((e) => { if (!signFail) throw e; });
  if (signFail === "DOC_CHANGED")
    return NextResponse.json({ code: "DOC_CHANGED", error: "서명 페이지를 연 뒤 문서가 수정됐습니다. 페이지를 새로 고쳐 바뀐 내용을 확인한 뒤 다시 서명해 주세요." }, { status: 409 });
  if (signFail === "STEP_CHANGED")
    return NextResponse.json({ code: "STEP_CHANGED", error: "이미 서명됐거나 결재가 다시 시작된 문서입니다. 담당자에게 새 링크를 요청해 주세요." }, { status: 409 });
  // 알림은 저장이 끝난 뒤에만
  // 감사 기록(#205-4) — 동의·서명·완료
  await recordContractEvent({ ...evBase, type: "CONSENT", meta: { text: SIGN_CONSENT_TEXT, readToEnd: null } });
  await recordContractEvent({ ...evBase, type: "SIGNED", meta: { role: "외부 계약자", docVersion: step.approvalLine.contract.version } });
  if (!nextStep) await recordContractEvent({ ...evBase, type: "COMPLETED" });
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
      // 패키지 동반 문서도 같은 동의·서명으로 끝났다 — 문서마다 남긴다(#205-4)
      await recordContractEvent({ ...evBase, contractId: sib.id, stepOrder: sibStep.order, type: "CONSENT", meta: { text: SIGN_CONSENT_TEXT, readToEnd: null, bundleWith: contractId } });
      await recordContractEvent({ ...evBase, contractId: sib.id, stepOrder: sibStep.order, type: "SIGNED", meta: { role: "외부 계약자", bundleWith: contractId } });
      await recordContractEvent({ ...evBase, contractId: sib.id, stepOrder: sibStep.order, type: "COMPLETED" });
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
