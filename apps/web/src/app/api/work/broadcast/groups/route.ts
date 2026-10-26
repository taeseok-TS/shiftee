import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 「한 번에 보내기」의 **내 그룹**(2026-10-26 디렉터 요구 「나중에 또 보낼 수 있으니 대상 묶음을 본인만의 그룹으로」).
//  · 저장은 새 표 없이 AppSetting 한 줄 — key `broadcastGroups.<userId>`, value = JSON 배열(lib/notify-targets 와 같은 방식,
//    스키마 드리프트 없이). 관리자 1명당 한 줄이라 다른 사람 그룹은 key 자체가 달라 닿지 않는다
//  · 1명당 최대 20개, 이름 1~30자, 같은 이름이면 덮어쓰기(갱신). 개인 설정이라 감사 로그는 남기지 않는다
//  · GET 은 각 그룹에 **지금 유효한 대상 수**도 함께 준다 — 저장 뒤 퇴사·방 삭제로 빠질 대상을 화면이 알려 주기 위해
const MAX_GROUPS = 20;
const MAX_NAME = 30;
const MAX_USERS = 200;
const MAX_CHANNELS = 30;

type Group = { id: string; name: string; userIds: string[]; channelIds: string[]; updatedAt: string };

const keyOf = (userId: string) => `broadcastGroups.${userId}`;
const strList = (v: unknown) => Array.from(new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x.length > 0)));

async function readGroups(userId: string): Promise<Group[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: keyOf(userId) } });
  if (!row?.value) return [];
  try {
    const v = JSON.parse(row.value);
    if (!Array.isArray(v)) return [];
    // 저장값이 깨져 있어도 쓸 수 있는 줄만 살린다
    return v
      .filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
      .filter((g) => typeof g.id === "string" && typeof g.name === "string")
      .map((g) => ({
        id: g.id as string,
        name: g.name as string,
        userIds: strList(g.userIds),
        channelIds: strList(g.channelIds),
        updatedAt: typeof g.updatedAt === "string" ? g.updatedAt : "",
      }));
  } catch {
    return [];
  }
}

async function saveGroups(userId: string, groups: Group[]): Promise<void> {
  const value = JSON.stringify(groups);
  await prisma.appSetting.upsert({ where: { key: keyOf(userId) }, create: { key: keyOf(userId), value }, update: { value } });
}

async function requireAdmin() {
  const session = await getSession();
  if (!session) return { error: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }) };
  if (session.role !== "ADMIN") return { error: NextResponse.json({ error: "관리자만 쓸 수 있습니다." }, { status: 403 }) };
  return { session };
}

/** 내 그룹 목록 — 그룹마다 지금 보낼 수 있는 사람·방 수(validUsers·validChannels)를 함께 */
export async function GET() {
  const { session, error } = await requireAdmin();
  if (error) return error;
  const groups = await readGroups(session.userId);

  // 유효 기준은 broadcast POST 와 같다 — 사람: 재직(isActive·deletedAt null), 방: 그룹방이고 삭제 안 됐고 기본 방이거나 내가 멤버
  const allUserIds = Array.from(new Set(groups.flatMap((g) => g.userIds)));
  const allChannelIds = Array.from(new Set(groups.flatMap((g) => g.channelIds)));
  const [users, channels] = await Promise.all([
    allUserIds.length ? prisma.user.findMany({ where: { id: { in: allUserIds }, isActive: true, deletedAt: null }, select: { id: true } }) : [],
    allChannelIds.length
      ? prisma.workChannel.findMany({
          where: { id: { in: allChannelIds }, type: "CHANNEL", deletedAt: null, OR: [{ isDefault: true }, { members: { some: { userId: session.userId } } }] },
          select: { id: true },
        })
      : [],
  ]);
  const okUsers = new Set(users.map((u) => u.id));
  const okChannels = new Set(channels.map((c) => c.id));

  return NextResponse.json({
    groups: groups.map((g) => ({
      ...g,
      validUserIds: g.userIds.filter((id) => okUsers.has(id)),
      validChannelIds: g.channelIds.filter((id) => okChannels.has(id)),
    })),
  });
}

/** 저장·갱신 { name, userIds, channelIds } — 같은 이름이면 그 그룹을 덮어쓴다(id 유지) */
export async function PUT(request: NextRequest) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  const { name, userIds, channelIds } = body as { name?: unknown; userIds?: unknown; channelIds?: unknown };

  const groupName = typeof name === "string" ? name.trim() : "";
  if (!groupName) return NextResponse.json({ error: "그룹 이름을 적어 주세요." }, { status: 400 });
  if (groupName.length > MAX_NAME) return NextResponse.json({ error: `그룹 이름은 ${MAX_NAME}자까지입니다.` }, { status: 400 });
  const uids = strList(userIds);
  const cids = strList(channelIds);
  if (uids.length + cids.length === 0) return NextResponse.json({ error: "그룹에 넣을 사람이나 채팅방을 골라 주세요." }, { status: 400 });
  if (uids.length > MAX_USERS) return NextResponse.json({ error: `사람은 ${MAX_USERS}명까지 넣을 수 있습니다.` }, { status: 400 });
  if (cids.length > MAX_CHANNELS) return NextResponse.json({ error: `채팅방은 ${MAX_CHANNELS}개까지 넣을 수 있습니다.` }, { status: 400 });

  const groups = await readGroups(session.userId);
  const existing = groups.find((g) => g.name === groupName);
  if (!existing && groups.length >= MAX_GROUPS)
    return NextResponse.json({ error: `그룹은 ${MAX_GROUPS}개까지 만들 수 있습니다. 안 쓰는 그룹을 지워 주세요.` }, { status: 400 });

  const saved: Group = { id: existing?.id ?? randomUUID(), name: groupName, userIds: uids, channelIds: cids, updatedAt: new Date().toISOString() };
  const next = existing ? groups.map((g) => (g.id === existing.id ? saved : g)) : [...groups, saved];
  await saveGroups(session.userId, next);
  return NextResponse.json({ group: saved, updated: !!existing });
}

/** 삭제 { id } */
export async function DELETE(request: NextRequest) {
  const { session, error } = await requireAdmin();
  if (error) return error;

  const body = await request.json().catch(() => null);
  const id = body && typeof body === "object" && typeof (body as { id?: unknown }).id === "string" ? (body as { id: string }).id : "";
  if (!id) return NextResponse.json({ error: "지울 그룹을 골라 주세요." }, { status: 400 });

  const groups = await readGroups(session.userId);
  const target = groups.find((g) => g.id === id);
  if (!target) return NextResponse.json({ error: "그룹을 찾을 수 없습니다." }, { status: 404 });
  await saveGroups(session.userId, groups.filter((g) => g.id !== id));
  return NextResponse.json({ ok: true, name: target.name });
}
