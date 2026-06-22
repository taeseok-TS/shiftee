import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 회의 입장/유지 신호 — lastJoinedAt 갱신 (자동 종료 판단용)
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  await prisma.workMeeting.updateMany({
    where: { id, endedAt: null },
    data: { lastJoinedAt: new Date() },
  });
  return NextResponse.json({ ok: true });
}
