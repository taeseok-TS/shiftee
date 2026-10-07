import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordContractEvent } from "@/lib/contract-events";
import { pwTakeAttempt, pwFails, UNLOCK_MS, UNLOCK_VIA, sessionMark } from "@/lib/contract-pw";

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
  const lock = pwTakeAttempt(session.userId);
  if (lock) return NextResponse.json({ code: "PASSWORD_LOCKED", error: `비밀번호를 여러 번 틀렸습니다. ${Math.ceil((lock - Date.now()) / 60000)}분 뒤에 다시 시도해 주세요.` }, { status: 429 });
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { password: true } });
  if (!me?.password || !(await bcrypt.compare(body.password, me.password))) {
    await recordContractEvent({ contractId: id, type: "VERIFY_FAIL", actorId: session.userId, actorName: session.name, stepOrder: mine.order, request, meta: { via: UNLOCK_VIA } });
    return NextResponse.json({ code: "PASSWORD_MISMATCH", error: "비밀번호가 맞지 않습니다." }, { status: 400 });
  }
  pwFails.delete(session.userId);
  await recordContractEvent({ contractId: id, type: "VERIFY_OK", actorId: session.userId, actorName: session.name, stepOrder: mine.order, request, meta: { via: UNLOCK_VIA, sid: sessionMark(session) } });
  return NextResponse.json({ ok: true, validUntil: new Date(Date.now() + UNLOCK_MS).toISOString() });
}
