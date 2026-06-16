import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 진행 중인 회의 목록
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const meetings = await prisma.workMeeting.findMany({
    where: { endedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ meetings });
}

// 회의 생성 (방 개설)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { title } = await request.json();
  // 고유 방 이름 (Jitsi 공개 서버에서 충돌 방지 위해 prefix + 랜덤)
  const room = `shiftee-${Math.random().toString(36).slice(2, 10)}`;
  const meeting = await prisma.workMeeting.create({
    data: { room, title: title?.trim() || "화상회의", createdBy: session.userId },
  });
  return NextResponse.json({ meeting });
}
