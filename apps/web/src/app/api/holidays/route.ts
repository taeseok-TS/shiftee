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
  // 「대체휴무 부여」 지정을 끌 때(2026-10-08 본부 답변 #56): 부여 N명·그중 회수하면 잔여가 마이너스가 되는 사람 M명을 먼저 보여 주고
  // (confirm 없음 → needConfirm), M>0 이면 끄지 못하게 막는다. 판정은 사람마다 대체휴일 전체 순잔여(모든 부여 − 승인·대기 사용)에서
  // 이 날 부여분을 빼 본 값이다 — 「그 날 이후 신청이 있으면 사용」 같은 어림짐작이 아니다(6722cfb 검증 F5). 아무도 모자라지 않으면
  // 끄면서 부여분을 회수하고(같은 트랜잭션, 검증 F6) 이력을 남긴다
  let revokeIds: string[] = [];
  if (before?.grantsLeave && grantsLeave === false) {
    const grantsOnDay = await prisma.leaveGrant.findMany({ where: { source: "AUTO", group: "대체휴일", workDate: new Date(date) }, select: { id: true, userId: true, days: true, user: { select: { name: true } } } });
    const userIds = [...new Set(grantsOnDay.map((g) => g.userId))];
    const short = new Set<string>();
    if (userIds.length) {
      const [allGrants, uses] = await Promise.all([
        prisma.leaveGrant.groupBy({ by: ["userId"], where: { userId: { in: userIds }, group: "대체휴일" }, _sum: { days: true } }),
        prisma.leaveRequest.groupBy({ by: ["userId"], where: { userId: { in: userIds }, status: { in: ["APPROVED", "PENDING"] }, type: { in: ["COMPENSATORY", "COMPENSATORY_HALF"] } }, _sum: { days: true } }),
      ]);
      const net = new Map(allGrants.map((g) => [g.userId, g._sum.days ?? 0]));
      for (const u of uses) net.set(u.userId, (net.get(u.userId) ?? 0) - (u._sum.days ?? 0));
      for (const g of grantsOnDay) if ((net.get(g.userId) ?? 0) - g.days < -1e-9) short.add(g.userId);
    }
    if (short.size > 0)
      return NextResponse.json({ error: `이 날 부여분을 거두면 대체휴일 잔여가 마이너스가 되는 직원이 ${short.size}명 있어 지정을 끌 수 없습니다(이미 사용·신청). 부여 ${userIds.length}명 · 부족 ${short.size}명 — ${grantsOnDay.filter((g) => short.has(g.userId)).map((g) => g.user.name).slice(0, 10).join(", ")}`, granted: userIds.length, used: short.size }, { status: 409 });
    if (confirm !== true)
      return NextResponse.json({ needConfirm: true, granted: userIds.length, used: 0, names: grantsOnDay.map((g) => g.user.name).slice(0, 20) });
    revokeIds = grantsOnDay.map((g) => g.id);
  }
  const [holiday, revoked] = await prisma.$transaction(async (tx) => {
    const h = await tx.holiday.upsert({
      where: { date: new Date(date) },
      create: { date: new Date(date), name: name.trim(), grantsLeave: grantsLeave === true },
      update: { name: name.trim(), ...(typeof grantsLeave === "boolean" ? { grantsLeave } : {}) },
    });
    const n = revokeIds.length ? (await tx.leaveGrant.deleteMany({ where: { id: { in: revokeIds } } })).count : 0;
    return [h, n] as const;
  });
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
  // 대체휴무 부여가 지정돼 이미 부여된 날은 바로 지우지 않는다 — 먼저 지정을 꺼서(사용 여부 확인·회수) 부여분을 정리해야 한다.
  // 그냥 지우면 부여분이 남은 채 밤 점검도 거두지 않는다(6722cfb 검증 F4)
  if (holiday.grantsLeave) {
    const n = await prisma.leaveGrant.count({ where: { source: "AUTO", group: "대체휴일", workDate: holiday.date } });
    if (n > 0) return NextResponse.json({ error: `이 날 대체휴일 부여분이 ${n}건 있습니다. 먼저 「대체휴무 부여」 지정을 끈 뒤(부여분 회수) 삭제해 주세요.` }, { status: 409 });
  }

  await prisma.holiday.delete({ where: { id } });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "HOLIDAY_DELETE",
    targetType: "Holiday", targetId: id, targetName: holiday.name,
    detail: `공휴일 삭제 ${holiday.date.toISOString().slice(0, 10)} ${holiday.name}`,
  });
  return NextResponse.json({ success: true });
}
