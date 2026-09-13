import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// 내가 속한 방 목록 — 그룹 방·1:1 (회의 전용 숨김 방 제외). canWrite = 키 생성 때 고른 방
export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, "chat:read");
  if (a.ok === false) return a.res; // strictNullChecks 없이는 !a.ok 로 좁혀지지 않는다
  const { user, key } = a.p;
  const rows = await prisma.workChannel.findMany({
    where: {
      hidden: false, deletedAt: null,
      OR: [{ isDefault: true }, { members: { some: { userId: user.id } } }],
    },
    select: { id: true, name: true, type: true, isDefault: true, members: { select: { userId: true, user: { select: { name: true } } } } },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({
    channels: rows.map((c) => ({
      id: c.id,
      name: c.type === "DM" ? (c.members.find((m) => m.userId !== user.id)?.user.name ?? "대화") : c.name,
      type: c.type,
      memberCount: c.members.length,
      canWrite: key.scopes.includes("chat:write") && key.channelIds.includes(c.id),
    })),
  });
}
