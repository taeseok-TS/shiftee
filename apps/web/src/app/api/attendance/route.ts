import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { calcStatus } from "@/lib/attendance-status";
import { personLabelOf, recordAttendanceEdit } from "@/lib/attendance-edit";
import { getManagerBranches } from "@/lib/manager-branches";
import { isAllowed } from "@/lib/permission-settings";
import { canSeeClockTimes, maskClock } from "@/lib/attendance-visibility";
import { isGranted, recordGrantDays } from "@/lib/record-grants";
import { showTestRows, testAccountWhere } from "@/lib/employee-scope";

// 출퇴근 기록 수동 생성 (관리자 전용) — 기록이 없는 날짜용
// body: { userId | userIds: string[], date: "YYYY-MM-DD", clockIn?: string, clockOut?: string, reason?: string, preview?: boolean } (시각은 ISO 8601, 최소 1개)
//  · 만든 기록은 수정 이력(AttendanceEdit, 원래 기록 없음 → 넣은 시각)과 사유를 같은 트랜잭션으로 남긴다(#219-15)
//  · userIds 로 여러 명을 같은 시각으로 한꺼번에(#215-5). 이미 기록이 있는 사람은 건너뛰고 이름을 돌려준다(한 명만이면 종전처럼 409)
//  · preview:true 면 쓰지 않고 대상자마다 기록 유무만 돌려준다(저장 전 미리보기)
// GPS 좌표는 실측이 아니므로 null로 생성 — 수동 생성 사실은 감사 로그가 증명
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "출퇴근 기록 생성은 관리자만 가능합니다." }, { status: 403 });

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const { date, clockIn, clockOut, preview } = body;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 300) : "";
  const rawIds: string[] = Array.isArray(body.userIds)
    ? (body.userIds as unknown[]).filter((v): v is string => typeof v === "string" && !!v)
    : typeof body.userId === "string" && body.userId ? [body.userId] : [];
  const userIds = [...new Set(rawIds)];
  if (!userIds.length || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return NextResponse.json({ error: "직원과 날짜(YYYY-MM-DD)를 입력해주세요." }, { status: 400 });
  if (userIds.length > 200) return NextResponse.json({ error: "한 번에 200명까지 넣을 수 있습니다." }, { status: 400 });

  const targets = await prisma.user.findMany({ where: { id: { in: userIds }, deletedAt: null }, select: { id: true, name: true } });
  if (targets.length !== userIds.length) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  const dateUtc = new Date(date); // "YYYY-MM-DD" → UTC 자정 (@db.Date 저장 규칙)
  const existingIds = new Set((await prisma.attendance.findMany({ where: { userId: { in: userIds }, date: dateUtc }, select: { userId: true } })).map((a) => a.userId));
  if (preview === true)
    return NextResponse.json({ preview: targets.map((t) => ({ userId: t.id, name: t.name, exists: existingIds.has(t.id) })) });

  const parse = (v: unknown): Date | null | "invalid" => {
    if (v === undefined || v === null || v === "") return null;
    const d = new Date(String(v));
    return isNaN(d.getTime()) ? "invalid" : d;
  };
  const inAt = parse(clockIn);
  const outAt = parse(clockOut);
  if (inAt === "invalid" || outAt === "invalid")
    return NextResponse.json({ error: "시각 형식이 올바르지 않습니다." }, { status: 400 });
  if (!inAt && !outAt)
    return NextResponse.json({ error: "출근 또는 퇴근 시각을 최소 1개 입력해주세요." }, { status: 400 });
  if (inAt && outAt && outAt < inAt)
    return NextResponse.json({ error: "퇴근 시각이 출근 시각보다 빠릅니다." }, { status: 400 });

  if (userIds.length === 1 && existingIds.size)
    return NextResponse.json({ error: "해당 날짜에 이미 출퇴근 기록이 있습니다. 수정 기능을 사용해주세요." }, { status: 409 });

  const fmt = (d: Date | null) => (d ? new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(11, 16) : "-");
  const bulk = userIds.length > 1;
  const editorName = await personLabelOf(session.userId, session.name);
  let attendance: { id: string } | null = null;
  const skipped: string[] = [];
  let created = 0;
  for (const t of targets) {
    if (existingIds.has(t.id)) { skipped.push(t.name); continue; }   // 겹치는 사람은 건너뛴다(미리보기에서 이미 표시됨)
    const status = await calcStatus(inAt, outAt, date, t.id);
    try {
      attendance = await prisma.$transaction(async (tx) => {
        const a = await tx.attendance.create({
          data: { userId: t.id, date: dateUtc, clockIn: inAt, clockOut: outAt, status },
        });
        await recordAttendanceEdit(tx, {
          attendanceId: a.id, userId: t.id, workDate: dateUtc, kind: "ADMIN_CREATE",
          before: null, after: { clockIn: inAt, clockOut: outAt, status },
          reason, editorId: session.userId, editorName,
        });
        return a;
      });
    } catch (e) {
      // 확인과 생성 사이에 다른 관리자가 같은 날 기록을 넣었으면(userId_date 유일 제약) 그 사람만 건너뛴다 — 중간에 500 으로 끊지 않는다(a59a786 검증 F3)
      if ((e as { code?: string })?.code === "P2002") { skipped.push(t.name); continue; }
      throw e;
    }
    await logAudit({
      actorId: session.userId,
      actorName: session.name,
      action: "ATTENDANCE_CREATE",
      targetType: "Attendance",
      targetId: attendance.id,
      targetName: t.name,
      detail: `${t.name} ${date} 기록 수동 생성${bulk ? `(일괄 ${userIds.length}명)` : ""} — 출근 ${fmt(inAt)}, 퇴근 ${fmt(outAt)} (${status})${reason ? ` · 사유: ${reason}` : ""}`,
    });
    created++;
  }

  return NextResponse.json({ success: true, attendance, created, skipped });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  // 직원은 본인 기록만, 시각 없이 상태만 받는다(2026-10-23 ■0-11 — 앱 「지난 기록」 날짜별 상태 알약).
  // 종전(10/17 #219 검증 P1)에는 「본인 출퇴근 기록 열람」이 꺼지면 403 이었다 — 그때 막은 것은 시각이었고, 이제 시각은 늘 빠지므로
  // 이 설정은 웹 「내 출퇴근」 메뉴 · 화면(과 웹 기간 합계 api/attendance/stats)만 정한다.

  const { searchParams } = new URL(request.url);
  const year   = parseInt(searchParams.get("year")  || String(new Date().getFullYear()));
  const month  = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));
  const userId = searchParams.get("userId") || session.userId;

  const startDate = new Date(year, month - 1, 1);
  const endDate   = new Date(year, month, 0);

  // 접근 범위 결정
  let userWhere: Record<string, unknown>;
  if (session.role === "EMPLOYEE") {
    userWhere = { userId: session.userId };
  } else if (session.role === "MANAGER" && !(await isAllowed("manager.viewAttendance"))) {
    userWhere = { userId: session.userId };   // 「지점 출퇴근 기록 열람」이 꺼지면 원장도 본인 기록만(권한 설정 #39)
  } else if (session.role === "MANAGER") {
    // 지정 userId가 담당 지점(대표+겸직) 소속인지 확인
    const myBranches = await getManagerBranches(session.userId);
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { branch: true } });
    if (target && !!target.branch && myBranches.includes(target.branch)) {
      userWhere = { userId };
    } else {
      // 담당 지점 구성원 전체 (관리자·서브관리자 제외 — 관리자 화면과 동일 기준)
      // 테스트 계정은 기본으로 뺀다 — 테스트지점 원장(검증 계정)은 그대로 본다(lib/employee-scope showTestRows, 2026-10-23)
      const withTests = await showTestRows(session, { branches: myBranches });
      userWhere = { user: { branch: { in: myBranches }, role: { not: "ADMIN" }, ...(withTests ? {} : { NOT: await testAccountWhere() }) } };
    }
  } else {
    userWhere = { userId };
  }

  const records = await prisma.attendance.findMany({
    where: { ...userWhere, date: { gte: startDate, lte: endDate } },
    include: { user: { select: { name: true } } },
    orderBy: { date: "desc" },
  });

  // 찍은 시각은 본부만(■0-11) — 직원 · 원장(「출퇴근 시각 보기」 끔)에게는 상태와 찍었는지만.
  // 단, 본부가 승인한 「출퇴근 기록 요청」 기간의 날짜는 본인 · 지점 원장에게 시각을 푼다(2026-10-27 이예지 ⑦, lib/record-grants)
  const showTimes = await canSeeClockTimes(session.role);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const grants = showTimes || !records.length
    ? new Map<string, Set<string>>()
    : await recordGrantDays([...new Set(records.map((r) => r.userId))], ymd(new Date(Date.UTC(year, month - 1, 1))), ymd(new Date(Date.UTC(year, month, 0))));
  return NextResponse.json({
    records: records.map((r) => {
      const granted = !showTimes && isGranted(grants, r.userId, ymd(r.date));
      return { ...maskClock(r, showTimes || granted), ...(granted ? { timesGranted: true } : {}) };
    }),
    timesHidden: !showTimes,
  });
}
