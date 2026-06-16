import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { emitWork } from "@/lib/work-events";

// 타이핑 중 신호
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  emitWork({ type: "typing", channelId: id, userId: session.userId, userName: session.name });
  return NextResponse.json({ ok: true });
}
