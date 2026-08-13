import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { emitWork, setTyping, getTyping } from "@/lib/work-events";

// 타이핑 중 신호 (SSE 브로드캐스트 + 모바일 폴링용 저장)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
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
  return NextResponse.json({ typing: getTyping(id, session.userId, Date.now()) });
}
