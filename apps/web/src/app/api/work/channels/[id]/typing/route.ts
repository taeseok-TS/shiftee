import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { emitWork, setTyping, getTyping } from "@/lib/work-events";
import { assertChannelAccess } from "@/lib/work-access";
import { getHiddenUserIds } from "@/lib/hidden-accounts";
import { prisma } from "@/lib/db";

// 타이핑 중 신호 (SSE 브로드캐스트 + 모바일 폴링용 저장)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  // 그 방 사람만 — 없던 검사라 아무 방에나 "입력 중" 신호를 넣을 수 있었다(2026-09-30 검증관)
  const acc = await assertChannelAccess(id, session.userId);
  if (!acc.ok) return NextResponse.json({ error: acc.error }, { status: acc.status });
  // 개발자 영역(메인 관리자)의 「입력 중」은 그룹·전체 채널에 알리지 않는다 — 실시간 신호는 방 단위로 나가
  // 받는 사람마다 거를 수 없어서 보내는 쪽에서 막는다(보는 사람에게도 안 보인다). DM 은 그대로(2026-10-17 디렉터)
  if ((await getHiddenUserIds()).includes(session.userId)) {
    const ch = await prisma.workChannel.findUnique({ where: { id }, select: { type: true } });
    if (ch?.type !== "DM") return NextResponse.json({ ok: true });
  }
  setTyping(id, session.userId, session.name, Date.now());
  emitWork({ type: "typing", channelId: id, userId: session.userId, userName: session.name });
  return NextResponse.json({ ok: true });
}

// 현재 타이핑 중인 사용자(본인 제외) — 모바일 폴링용
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  // 그 방 사람만 — 없던 검사라 아무 방이나 "누가 입력 중인지" 조회됐다
  const acc = await assertChannelAccess(id, session.userId);
  if (!acc.ok) return NextResponse.json({ error: acc.error }, { status: acc.status });
  return NextResponse.json({ typing: getTyping(id, session.userId, Date.now()) });
}
