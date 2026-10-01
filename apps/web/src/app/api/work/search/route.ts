import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 메시지 검색 (접근 가능한 채널 내)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json({ results: [] });

  // 접근 가능한 채널: '전체' 기본 채널 + 내가 멤버인 그룹채널/DM
  const channels = await prisma.workChannel.findMany({
    where: {
      hidden: false, // 회의 전용 방은 채널 목록에 없다 — 검색 결과로도 내지 않는다(2026-09-30 회의 참여자가 멤버가 되면서)
      OR: [
        { isDefault: true },
        { type: "CHANNEL", members: { some: { userId: session.userId } } },
        { type: "DM", members: { some: { userId: session.userId } } },
      ],
    },
    select: { id: true, name: true, type: true, members: { include: { user: { select: { id: true, name: true } } } } },
  });
  // 타입을 명시하지 않으면 튜플이 배열로 넓어져 Map 값이 unknown 이 된다
  type Ch = (typeof channels)[number];
  const channelMap = new Map<string, Ch>(channels.map((c) => [c.id, c]));

  // 과거 기록 범위 — 범위가 있는 방은 그 시각 이후 글만(2026-10-01)
  const { myHistoryFromMap } = await import("@/lib/work-access");
  const froms = await myHistoryFromMap(session.userId, channels.map((c) => c.id));
  const openIds = channels.map((c) => c.id).filter((cid) => !froms.has(cid));
  const messages = await prisma.workMessage.findMany({
    where: {
      OR: [
        { channelId: { in: openIds } },
        ...[...froms].map(([cid, from]) => ({ channelId: cid, createdAt: { gte: from } })),
      ],
      content: { contains: q, mode: "insensitive" },
      deletedAt: null, // 삭제된 메시지 원문 노출 방지
    },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const results = messages.map((m) => {
    const ch = channelMap.get(m.channelId)!;
    let channelName = ch.name;
    if (ch.type === "DM") {
      const other = ch.members.find((mm) => mm.userId !== session.userId);
      channelName = other?.user.name ?? "대화";
    }
    return {
      id: m.id,
      channelId: m.channelId,
      channelName,
      userName: m.user.name,
      content: m.content,
      createdAt: m.createdAt,
    };
  });

  return NextResponse.json({ results });
}
