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
    holidays: holidays.map((h) => ({ id: h.id, date: h.date.toISOString().slice(0, 10), name: h.name, grantsLeave: h.grantsLeave })),
  });
}

// 공휴일 추가 (관리자) — { date: "YYYY-MM-DD", name, grantsLeave? } (임시공휴일 대응)
// grantsLeave(#56): 「대체휴무 부여」 지정 — 이 날(평일) 근무 기록이 있으면 대체휴일 1일 자동 부여. 같은 날짜로 다시 보내면 지정만 바꾼다
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 공휴일을 관리할 수 있습니다." }, { status: 403 });

  const { date, name, grantsLeave, confirm } = await request.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !name?.trim())
    return NextResponse.json({ error: "날짜(YYYY-MM-DD)와 이름을 입력해주세요." }, { status: 400 });

  // 동기화/시드 실패가 기존 데이터를 지우지 않도록 upsert만 사용
  const before = await prisma.holiday.findUnique({ where: { date: new Date(date) }, select: { grantsLeave: true, name: true } });
  // 「대체휴무 부여」 지정을 끌 때(2026-10-08 본부 답변 #56): 부여 N명·이미 사용 M명을 먼저 보여 주고(confirm 없음 → needConfirm),
  // 사용한 사람이 한 명이라도 있으면 끄지 못하게 막는다(잔여 마이너스 방지). 아무도 안 썼으면 끄면서 부여분을 회수하고 이력을 남긴다
  let revokeIds: string[] = [];
  if (before?.grantsLeave && grantsLeave === false) {
    const grantsOnDay = await prisma.leaveGrant.findMany({ where: { source: "AUTO", group: "대체휴일", workDate: new Date(date) }, select: { id: true, userId: true, user: { select: { name: true } } } });
    const userIds = [...new Set(grantsOnDay.map((g) => g.userId))];
    const usedUsers = userIds.length
      ? new Set((await prisma.leaveRequest.findMany({ where: { userId: { in: userIds }, status: { in: ["APPROVED", "PENDING"] }, type: { in: ["COMPENSATORY", "COMPENSATORY_HALF"] }, startDate: { gte: new Date(date) } }, select: { userId: true } })).map((l) => l.userId))
      : new Set<string>();
    if (usedUsers.size > 0)
      return NextResponse.json({ error: `이 날 대체휴일을 이미 사용(또는 신청 중)한 사람이 ${usedUsers.size}명 있어 지정을 끌 수 없습니다(잔여가 마이너스가 됩니다). 부여 ${userIds.length}명 · 사용 ${usedUsers.size}명`, granted: userIds.length, used: usedUsers.size }, { status: 409 });
    if (confirm !== true)
      return NextResponse.json({ needConfirm: true, granted: userIds.length, used: 0, names: grantsOnDay.map((g) => g.user.name).slice(0, 20) });
    revokeIds = grantsOnDay.map((g) => g.id);
  }
  const holiday = await prisma.holiday.upsert({
    where: { date: new Date(date) },
    create: { date: new Date(date), name: name.trim(), grantsLeave: grantsLeave === true },
    update: { name: name.trim(), ...(typeof grantsLeave === "boolean" ? { grantsLeave } : {}) },
  });
  let revoked = 0;
  if (revokeIds.length) revoked = (await prisma.leaveGrant.deleteMany({ where: { id: { in: revokeIds } } })).count;
  // 같은 날짜를 다시 보내 지정만 바꾼 것이면 「지정/해제」로 남긴다(등록으로 남기면 켠 건지 끈 건지 알 수 없다)
  const toggled = !!before && typeof grantsLeave === "boolean" && before.grantsLeave !== grantsLeave;
  await logAudit({
    actorId: session.userId, actorName: session.name, action: toggled ? "HOLIDAY_GRANT_TOGGLE" : "HOLIDAY_ADD",
    targetType: "Holiday", targetId: holiday.id, targetName: name.trim(),
    detail: toggled
      ? `대체휴무 부여 ${holiday.grantsLeave ? "지정" : "해제"} ${date} ${name.trim()}${revoked ? ` — 부여분 ${revoked}건 회수(사용자 없음)` : ""}`
      : `공휴일 등록 ${date} ${name.trim()}${holiday.grantsLeave ? " (대체휴무 부여)" : ""}`,
  });
  return NextResponse.json({ success: true, holiday, revoked });
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
