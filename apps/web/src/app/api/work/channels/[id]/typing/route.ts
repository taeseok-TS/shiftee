import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { emitWork, setTyping, getTyping } from "@/lib/work-events";
import { assertChannelAccess } from "@/lib/work-access";

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
