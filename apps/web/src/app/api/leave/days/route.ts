import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { leaveInfo } from "@/lib/leave-catalog";
import { ensureLeaveCatalog } from "@/lib/leave-catalog-db";
import { isRealDate } from "@/lib/schedule-payload";
import { countLeaveDays, splitWorkdaysByYear } from "@/lib/leave-days";
import { checkLeaveLimit, limitMessage } from "@/lib/leave-limit";
import { canSeeLeaveBalance } from "@/lib/permission-settings";
import { ledgerAccess } from "@/lib/leave-ledger";

export const dynamic = "force-dynamic";

/**
 * 휴가 신청 창 미리보기(2026-10-16 #219-10·11·12) — 「신청 일수」와 「신청 가능 여부」를 **서버 신청 검사와 같은 함수**로 낸다.
 *   GET /api/leave/days?start=YYYY-MM-DD&end=YYYY-MM-DD&type=ANNUAL[&userId=]
 * 일수 = lib/leave-days(근무일정 기준 — 일정 WORK 는 셈, OFF·HOLIDAY 는 안 셈, 일정 없는 날은 평일·비공휴일만),
 * 막기 = lib/leave-limit(연차·보상휴가·대체휴일 잔여, 결재 대기분 합산). 화면은 이 값으로만 일수를 그리고 신청 버튼을 막는다.
 * userId — 본부 대리 등록(본부: 아무 직원) · 원장은 담당 지점 직원만(연차 대장과 같은 범위, lib/leave-ledger ledgerAccess).
 * 잔여 숫자는 「잔여 연차 숫자 보기」 설정(#219-1)을 따른다 — 숨김이면 limit 의 숫자는 null 이고 막기·사유만 온다.
 * 조회만 한다(GET 은 순수하게 — 무중단 배포 프록시가 GET 을 재시도한다).
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const sp = new URL(request.url).searchParams;
  const type = sp.get("type") ?? "";
  const start = sp.get("start") ?? "";
  const userId = sp.get("userId") || session.userId;

  await ensureLeaveCatalog();   // 본부가 만든 유형(#216-1)의 단위·그룹을 알아야 한다
  const info = type ? leaveInfo(type) : undefined;
  if (!info || !info.selectable) return NextResponse.json({ error: "지금은 신청할 수 없는 휴가 유형입니다." }, { status: 400 });
  // 하루짜리 유형은 종료일을 안 줘도 된다(시작일과 같다)
  const end = info.unit !== "FULL" ? (sp.get("end") || start) : (sp.get("end") ?? "");
  if (!isRealDate(start) || !isRealDate(end)) return NextResponse.json({ error: "날짜 형식이 올바르지 않습니다. (YYYY-MM-DD)" }, { status: 400 });
  if (start > end) return NextResponse.json({ error: "종료일이 시작일보다 빠릅니다." }, { status: 400 });
  if (info.unit !== "FULL" && start !== end) return NextResponse.json({ error: `${info.label}은(는) 하루만 신청할 수 있습니다.` }, { status: 400 });
  if ((new Date(end).getTime() - new Date(start).getTime()) / 86400000 > 366) {
    return NextResponse.json({ error: "휴가 신청 기간은 최대 1년까지 가능합니다." }, { status: 400 });
  }

  if (userId !== session.userId) {
    const access = await ledgerAccess(session, userId);
    if (access === "notfound") return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
    if (access === "forbidden") return NextResponse.json({ error: "이 직원의 휴가 일수를 볼 권한이 없습니다." }, { status: 403 });
  }

  const visible = await canSeeLeaveBalance(session.role);
  const counted = await countLeaveDays(prisma, userId, info.unit, start, end, !!info.calendarDays);
  const base = { start, end, type, unit: info.unit, workdays: counted.workdays, balanceHidden: !visible };
  if (counted.error) {
    return NextResponse.json({ ...base, days: 0, blocked: true, code: "NO_WORKDAY", reason: counted.error, limit: null });
  }

  // 연도를 걸친 휴가는 해마다 몫으로 그 해 잔여를 본다(신청 검사와 같은 나눔 — 2026-10-19)
  const byYear = splitWorkdaysByYear(counted.workdays, counted.days, start);
  const limit = await checkLeaveLimit(prisma, { userId, type, startDate: new Date(start), endDate: new Date(end), days: counted.days, byYear, includePending: true });
  const who = userId !== session.userId ? (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name : undefined;
  const limitOut =
    limit.kind === "none" ? null
      : {
          kind: limit.kind,
          year: limit.kind === "annual" ? limit.year : null,
          group: limit.kind === "grant" ? limit.group : null,
          // 숨김이면 숫자는 내지 않는다(서버 응답까지 — 디렉터 결정 (a))
          remaining: visible ? limit.remaining : null,
          pending: visible ? limit.pending : null,
          available: visible ? limit.available : null,
          // 해마다 몫(연도를 걸친 휴가만 둘 이상) — 「2026년 1일 · 2027년 1일」 안내용. 숫자 숨김이면 몫만
          years: limit.kind === "annual"
            ? limit.years.map((y) => ({ year: y.year, days: y.requested, remaining: visible ? y.remaining : null, available: visible ? y.available : null, blocked: y.blocked }))
            : null,
        };
  return NextResponse.json({
    ...base,
    days: counted.days,
    blocked: limit.blocked,
    code: limit.blocked ? "OVER_LIMIT" : null,
    reason: limit.blocked ? limitMessage(limit, { visible, when: "request", who }) : null,
    limit: limitOut,
  });
}
