import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// 이모티콘 세트 관리(관리자) — 2026-09-29. 목록(꺼진 것 포함) + 세트 만들기.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });

  const sets = await prisma.emoticonSet.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true, name: true, isActive: true, sortOrder: true, createdAt: true,
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, url: true, animated: true, isActive: true, sortOrder: true },
      },
    },
  });
  // 이미 보낸 적 있는 이모티콘은 지울 수 없다(보낸 메시지의 그림이 깨진다) — 화면이 [삭제] 대신 [숨기기]만 보이게
  const urls = sets.flatMap((s) => s.items.map((i) => i.url));
  const used = urls.length
    ? await prisma.workMessage.groupBy({ by: ["fileUrl"], where: { fileType: "sticker", fileUrl: { in: urls } }, _count: { _all: true } })
    : [];
  const usedMap = new Map(used.map((u) => [u.fileUrl, u._count._all]));
  return NextResponse.json({
    sets: sets.map((s) => ({
      ...s,
      items: s.items.map((i) => ({ ...i, sentCount: usedMap.get(i.url) ?? 0 })),
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });

  const { name } = (await request.json().catch(() => ({}))) as { name?: unknown };
  const n = typeof name === "string" ? name.trim().slice(0, 30) : "";
  if (!n) return NextResponse.json({ error: "세트 이름을 입력해주세요." }, { status: 400 });

  const last = await prisma.emoticonSet.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const set = await prisma.emoticonSet.create({
    data: { name: n, sortOrder: (last?.sortOrder ?? 0) + 1, createdBy: session.userId },
  });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMOTICON_SET_CREATE",
    targetType: "EMOTICON_SET", targetId: set.id, targetName: n, detail: "이모티콘 세트 만들기",
  });
  return NextResponse.json({ set });
}

// 세트 순서 한 번에 — 화면이 원하는 순서대로 id 를 보내면 1,2,3… 으로 다시 매긴다.
// (두 세트의 번호를 맞바꾸는 방식은 번호가 같으면 아무 일도 안 일어났다 — 검증관 5)
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });

  const { setIds } = (await request.json().catch(() => ({}))) as { setIds?: unknown };
  if (!Array.isArray(setIds) || !setIds.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "순서가 올바르지 않습니다." }, { status: 400 });
  }
  const ids = setIds as string[];
  const all = await prisma.emoticonSet.findMany({ select: { id: true } });
  if (ids.length !== all.length || new Set(ids).size !== ids.length || !all.every((s) => ids.includes(s.id))) {
    return NextResponse.json({ error: "세트 목록이 바뀌었습니다. 새로고침 후 다시 해주세요." }, { status: 409 });
  }
  try {
    await prisma.$transaction(ids.map((id, i) => prisma.emoticonSet.update({ where: { id }, data: { sortOrder: i + 1 } })));
  } catch {
    // 그사이 누가 지웠거나 다른 관리자와 동시에 바꿨다 — 데이터는 트랜잭션으로 그대로다
    return NextResponse.json({ error: "그사이 목록이 바뀌었습니다. 새로고침 후 다시 해주세요." }, { status: 409 });
  }
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMOTICON_REORDER",
    targetType: "EMOTICON_SET", targetId: null, targetName: null, detail: `세트 순서 ${ids.length}개 재정렬`,
  });
  return NextResponse.json({ success: true });
}
