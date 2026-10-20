import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordContractEvent } from "@/lib/contract-events";
import { checkContractPassword, UNLOCK_MS, UNLOCK_VIA, sessionMark } from "@/lib/contract-pw";

// 계약서를 받았을 때 첫 화면(시안 v2 5번)의 본인 확인 — 비밀번호 한 번으로 **지금 내 서명 차례인 서류 모두**를 연다.
// 규칙은 낱건 /api/contracts/[id]/unlock 과 같다(근로자 본인·내 차례·외부 계약 아님, 비밀번호 대조·틀린 횟수 제한은 같은 함수).
// 확인 기록(VERIFY_OK)을 서류마다 남기므로, 서명할 때 서버는 서류마다 지금처럼 30분·같은 기기·이번 회차를 다시 본다.
// 응답은 401 이 아니라 400/429 — 앱은 401 을 「로그인 만료」로 본다.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { ids?: unknown; password?: unknown };
  const ids = Array.isArray(body.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length < 64))].slice(0, 20) : [];
  if (!ids.length) return NextResponse.json({ error: "열 서류가 없습니다." }, { status: 400 });
  const rows = await prisma.contract.findMany({
    where: { id: { in: ids } },
    select: { id: true, userId: true, externalName: true, approvalLine: { select: { steps: { select: { order: true, approverId: true, status: true } } } } },
  });
  const mine = rows
    .filter((c) => c.userId === session.userId && !c.externalName)
    .map((c) => ({ id: c.id, step: c.approvalLine?.steps.find((s) => s.approverId === session.userId && s.status === "PENDING") }))
    .flatMap((x) => (x.step ? [{ id: x.id, order: x.step.order }] : []));
  if (!mine.length) return NextResponse.json({ code: "NOT_YOUR_TURN", error: "지금 본인 서명 차례인 계약이 없습니다." }, { status: 400 });
  if (typeof body.password !== "string" || !body.password)
    return NextResponse.json({ code: "PASSWORD_REQUIRED", error: "비밀번호를 입력해 주세요." }, { status: 400 });
  const pw = await checkContractPassword(session.userId, body.password);
  if (!pw.ok) {
    if (pw.code === "PASSWORD_MISMATCH")
      await recordContractEvent({ contractId: mine[0].id, type: "VERIFY_FAIL", actorId: session.userId, actorName: session.name, stepOrder: mine[0].order, request, meta: { via: UNLOCK_VIA } });
    return NextResponse.json({ code: pw.code, error: pw.error }, { status: pw.status });
  }
  const sid = sessionMark(session);
  for (const m of mine)
    await recordContractEvent({ contractId: m.id, type: "VERIFY_OK", actorId: session.userId, actorName: session.name, stepOrder: m.order, request, meta: { via: UNLOCK_VIA, sid } });
  return NextResponse.json({ ok: true, ids: mine.map((m) => m.id), validUntil: new Date(Date.now() + UNLOCK_MS).toISOString() });
}
