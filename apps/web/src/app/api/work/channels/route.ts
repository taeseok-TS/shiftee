import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 채널 목록 조회 (기본 '전체' 채널 자동 보장 + 본인 참여 채널)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // 기본 '전체' 채널 보장 (모든 사용자 공용)
  let general = await prisma.workChannel.findFirst({ where: { isDefault: true, type: "CHANNEL" } });
  if (!general) {
    general = await prisma.workChannel.create({
      data: { name: "전체", type: "CHANNEL", isDefault: true },
    });
  }

  // 공개 채널 전체 + 내가 멤버인 DM
  const channels = await prisma.workChannel.findMany({
    where: {
      OR: [
        { type: "CHANNEL" },
        { type: "DM", members: { some: { userId: session.userId } } },
      ],
    },
    include: {
      members: { include: { user: { select: { id: true, name: true } } } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { messages: true } },
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });

  const result = channels.map((c) => {
    // DM 채널은 상대방 이름으로 표시
    let displayName = c.name;
    if (c.type === "DM") {
      const other = c.members.find((m) => m.userId !== session.userId);
      displayName = other?.user.name ?? "대화";
    }
    const last = c.messages[0];
    return {
      id: c.id,
      name: displayName,
      type: c.type,
      isDefault: c.isDefault,
      memberCount: c.members.length,
      lastMessage: last ? { content: last.content, createdAt: last.createdAt } : null,
    };
  });

  return NextResponse.json({ channels: result });
}

// 채널 생성 (그룹 채널 또는 1:1 DM)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const body = await request.json();
  const { name, type, memberIds } = body as { name?: string; type?: string; memberIds?: string[] };

  if (type === "DM") {
    const otherId = (memberIds || [])[0];
    if (!otherId) return NextResponse.json({ error: "대화 상대를 선택해주세요." }, { status: 400 });

    // 기존 1:1 DM 있으면 재사용
    const existing = await prisma.workChannel.findFirst({
      where: {
        type: "DM",
        AND: [
          { members: { some: { userId: session.userId } } },
          { members: { some: { userId: otherId } } },
        ],
      },
    });
    if (existing) return NextResponse.json({ channel: existing });

    const channel = await prisma.workChannel.create({
      data: {
        name: "DM",
        type: "DM",
        createdBy: session.userId,
        members: { create: [{ userId: session.userId }, { userId: otherId }] },
      },
    });
    return NextResponse.json({ channel });
  }

  // 그룹 채널
  if (!name?.trim()) return NextResponse.json({ error: "채널 이름을 입력해주세요." }, { status: 400 });
  const ids = Array.from(new Set([session.userId, ...(memberIds || [])]));
  const channel = await prisma.workChannel.create({
    data: {
      name: name.trim(),
      type: "CHANNEL",
      createdBy: session.userId,
      members: { create: ids.map((userId) => ({ userId })) },
    },
  });
  return NextResponse.json({ channel });
}
