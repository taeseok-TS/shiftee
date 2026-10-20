import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordContractEvent } from "@/lib/contract-events";
import { checkContractPassword, recentUnlock, UNLOCK_MS, UNLOCK_VIA, sessionMark } from "@/lib/contract-pw";
import { requestInfo } from "@/lib/contract-events";

// 이미 확인했나(30분·같은 기기·이번 회차) — 첫 화면에서 한 번 확인하고 서명 창을 열 때 비밀번호를 다시 묻지 않게(시안 v2 5번).
// 서명 때 서버가 같은 함수(recentUnlock)로 다시 보므로, 이 값은 화면의 비밀번호 칸을 감출지만 정한다
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const c = await prisma.contract.findUnique({
    where: { id },
    select: { userId: true, externalName: true, approvalLine: { select: { steps: { select: { order: true, approverId: true, status: true } } } } },
  });
  const mine = c?.approvalLine?.steps.find((s) => s.approverId === session.userId && s.status === "PENDING");
  if (!c || c.userId !== session.userId || c.externalName || !mine) return NextResponse.json({ unlocked: false });
  return NextResponse.json({ unlocked: await recentUnlock(id, session.userId, mine.order, requestInfo(request), sessionMark(session)) });
}

// 문서 열기 전 본인 확인(2026-10-07 QA #20, 본부 답변 #30 「서명하는 사람은 첫 화면에서 본인 비밀번호를 입력해야 문서에 들어갈 수 있게」).
// 근로자 본인이 **자기 서명 차례**인 계약을 열 때 큐브티 로그인 비밀번호를 확인한다. 확인하면 30분 동안 서명할 때 다시 묻지 않는다.
// 관리자(재무)는 비밀번호 없이 모든 계약서를 본다(관리자 화면). 외부 계약자는 지금처럼 휴대폰 뒷자리.
// 응답은 401 이 아니라 400/429 — 앱은 401 을 「로그인 만료」로 보고 로그아웃시킨다.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  const c = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, userId: true, externalName: true, status: true, approvalLine: { select: { steps: { select: { order: true, approverId: true, status: true } } } } },
  });
  if (!c) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  const mine = c.approvalLine?.steps.find((s) => s.approverId === session.userId && s.status === "PENDING");
  if (c.userId !== session.userId || c.externalName || !mine)
    return NextResponse.json({ code: "NOT_YOUR_TURN", error: "지금 본인 서명 차례인 계약이 아닙니다." }, { status: 400 });
  if (typeof body.password !== "string" || !body.password)
    return NextResponse.json({ code: "PASSWORD_REQUIRED", error: "비밀번호를 입력해 주세요." }, { status: 400 });
  // 비밀번호 대조·틀린 횟수 제한은 서명·승인과 같은 함수(lib/contract-pw checkContractPassword, #220-3)
  const pw = await checkContractPassword(session.userId, body.password);
  if (!pw.ok) {
    if (pw.code === "PASSWORD_MISMATCH")
      await recordContractEvent({ contractId: id, type: "VERIFY_FAIL", actorId: session.userId, actorName: session.name, stepOrder: mine.order, request, meta: { via: UNLOCK_VIA } });
    return NextResponse.json({ code: pw.code, error: pw.error }, { status: pw.status });
  }
  await recordContractEvent({ contractId: id, type: "VERIFY_OK", actorId: session.userId, actorName: session.name, stepOrder: mine.order, request, meta: { via: UNLOCK_VIA, sid: sessionMark(session) } });
  return NextResponse.json({ ok: true, validUntil: new Date(Date.now() + UNLOCK_MS).toISOString() });
}
