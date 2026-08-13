import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// 공휴일 조회 — 로그인한 누구나 (캘린더 표시용). ?year=YYYY (기본: 올해 KST)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const year =
    Number(searchParams.get("year")) ||
    new Date(Date.now() + 9 * 60 * 60 * 1000).getUTCFullYear();

  const holidays = await prisma.holiday.findMany({
    where: { date: { gte: new Date(`${year}-01-01`), lte: new Date(`${year}-12-31`) } },
    orderBy: { date: "asc" },
  });
  return NextResponse.json({
    holidays: holidays.map((h) => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name })),
  });
}

// 공휴일 추가 (관리자) — { date: "YYYY-MM-DD", name } (임시공휴일 대응)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 공휴일을 관리할 수 있습니다." }, { status: 403 });

  const { date, name } = await request.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !name?.trim())
    return NextResponse.json({ error: "날짜(YYYY-MM-DD)와 이름을 입력해주세요." }, { status: 400 });

  // 동기화/시드 실패가 기존 데이터를 지우지 않도록 upsert만 사용
  const holiday = await prisma.holiday.upsert({
    where: { date: new Date(date) },
    create: { date: new Date(date), name: name.trim() },
    update: { name: name.trim() },
  });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "HOLIDAY_ADD",
    targetType: "Holiday", targetId: holiday.id, targetName: name.trim(),
    detail: `공휴일 등록 ${date} ${name.trim()}`,
  });
  return NextResponse.json({ success: true, holiday });
}

// 공휴일 삭제 (관리자) — ?id=
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 공휴일을 관리할 수 있습니다." }, { status: 403 });

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "삭제할 공휴일을 선택해주세요." }, { status: 400 });

  const holiday = await prisma.holiday.findUnique({ where: { id } });
  if (!holiday) return NextResponse.json({ error: "공휴일을 찾을 수 없습니다." }, { status: 404 });

  await prisma.holiday.delete({ where: { id } });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "HOLIDAY_DELETE",
    targetType: "Holiday", targetId: id, targetName: holiday.name,
    detail: `공휴일 삭제 ${holiday.date.toISOString().slice(0, 10)} ${holiday.name}`,
  });
  return NextResponse.json({ success: true });
}
