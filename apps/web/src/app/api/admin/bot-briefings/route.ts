import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { seedDefaultBriefing } from "@/lib/bot";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const REPEATS = new Set(["DAILY", "WEEKLY", "MONTHLY", "YEARLY"]);

// 브리핑 설정 목록 + 드롭다운용 채널/지점 목록 (관리자)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  await seedDefaultBriefing();
  const [briefings, channels, branches] = await Promise.all([
    prisma.botBriefing.findMany({ orderBy: [{ time: "asc" }, { createdAt: "asc" }] }),
    prisma.workChannel.findMany({
      where: { type: "CHANNEL", hidden: false, deletedAt: null },
      select: { id: true, name: true, isDefault: true },
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    }),
    prisma.branch.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  return NextResponse.json({ briefings, channels, branches: branches.map((b) => b.name) });
}

// 브리핑 추가 (관리자)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const { name, time, repeat, repeatValue, channelId, branch, folder } = (await request.json()) as {
    name?: string; time?: string; repeat?: string; repeatValue?: string; channelId?: string | null; branch?: string | null; folder?: string | null;
  };
  if (!name?.trim()) return NextResponse.json({ error: "브리핑 이름을 입력해주세요." }, { status: 400 });
  if (!time || !TIME_RE.test(time)) return NextResponse.json({ error: "시간은 HH:mm 형식이어야 합니다." }, { status: 400 });
  if (repeat && !REPEATS.has(repeat)) return NextResponse.json({ error: "반복 주기가 올바르지 않습니다." }, { status: 400 });

  const briefing = await prisma.botBriefing.create({
    data: {
      name: name.trim(),
      folder: folder?.trim() || null,
      time,
      repeat: repeat || "DAILY",
      repeatValue: repeatValue || null,
      channelId: channelId || null,
      branch: branch || null,
    },
  });
  return NextResponse.json({ success: true, briefing });
}
