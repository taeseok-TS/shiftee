import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs/promises";
import path from "path";

// 외부(미가입) 계약자 게스트 서명 — 로그인 없이 서명 링크 토큰으로 인증
// 토큰은 발송 시 생성(64자 랜덤, 14일 유효), 해당 단계가 자기 차례(PENDING)일 때만 서명 가능

async function findStepByToken(token: string) {
  if (!token || token.length < 32) return null;
  return prisma.contractApprovalStep.findUnique({
    where: { signToken: token },
    include: {
      approvalLine: {
        include: {
          contract: { select: { id: true, title: true, fileUrl: true, status: true, externalName: true, signedUrl: true } },
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

// 서명 페이지 초기 정보 — 계약 제목·문서·현재 상태
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
    : step.status === "REJECTED" || contract.status === "REJECTED"
    ? "rejected"
    : expired
    ? "expired"
    : step.status === "PENDING"
    ? "ready"
    : "waiting"; // 앞 단계 결재 대기 중

  // 문서는 서명 차례(ready)일 때만 노출 — 만료·완료 후 링크 유출로 계약서가 무기한 공개되는 것 방지
  return NextResponse.json({
    title: contract.title,
    externalName: step.externalName,
    fileUrl: state === "ready" ? firstFileUrl(contract.fileUrl) : null,
    state,
  });
}

// 게스트 서명 제출
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

  const { signatureData } = (await request.json().catch(() => ({}))) as { signatureData?: string };
  const m = /^data:image\/png;base64,(.+)$/.exec(signatureData || "");
  if (!m) return NextResponse.json({ error: "서명을 입력해주세요." }, { status: 400 });

  // 서명 이미지 저장
  const buffer = Buffer.from(m[1], "base64");
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}-ext-sign.png`;
  const dir = path.join(process.cwd(), "uploads", "signatures");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);
  const signatureUrl = `/api/uploads/signatures/${filename}`;

  const contractId = step.approvalLine.contract.id;
  const steps = step.approvalLine.steps;

  // 단계 승인 처리 + 다음 단계 진행 (기존 사내 결재와 동일한 흐름)
  await prisma.contractApprovalStep.update({
    where: { id: step.id },
    data: { status: "APPROVED", decidedAt: new Date(), signatureUrl },
  });
  const nextStep = steps.find((s) => s.order === step.order + 1);
  if (nextStep) {
    await prisma.contractApprovalStep.update({ where: { id: nextStep.id }, data: { status: "PENDING" } });
  }
  await prisma.contract.update({
    where: { id: contractId },
    data: {
      employeeSignedAt: new Date(), // 외부 계약자 = 근로자 서명
      status: !nextStep ? "SIGNED" : "APPROVED",
      signedAt: !nextStep ? new Date() : undefined,
    },
  });

  // 마지막 단계면 서명 완료본(서명+직인 포함) 생성
  if (!nextStep) {
    try {
      const { generateAndStoreSignedDoc } = await import("@/lib/signed-doc");
      await generateAndStoreSignedDoc(contractId);
    } catch (e) { console.error("외부 서명 완료본 생성 오류:", e); }
  }

  return NextResponse.json({ success: true, completed: !nextStep });
}
