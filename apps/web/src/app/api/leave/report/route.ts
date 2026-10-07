import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { isRealDate } from "@/lib/schedule-payload";
import { getHolidaySet, ymdUTC } from "@/lib/holidays";
import { leaveInfo } from "@/lib/leave-catalog";
import { kstTodayMidnight, isResigned } from "@/lib/resign";

export const dynamic = "force-dynamic";

// 휴가 사용 내역 리포트(2026-10-07 QA #29 #84 #85) — 기간·지점(여러 개)·재직자만으로 **승인된** 휴가를 뽑는다.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&branches=대치,평촌][&active=1]
// 기간에 걸친 휴가는 **기간 안의 날만** 센다(9/29~10/2 휴가를 10월로 뽑으면 10/1·10/2 만). 종일 휴가는 근무일(주말·공휴일 제외)
// 하루마다 1일, 반차·반반차는 0.5·0.25일. 유급 시간 = 일수 × 기준표 하루 유급 시간(반차는 반차 시간).
// 휴가 전체가 기간 안이면 **저장된 일수**(실제 차감된 값)를 쓴다 — 공휴일이 나중에 바뀌어도 잔여와 맞게(검증 P1).
// byMonth 는 월별 보기(#84)용 — 달마다 일수.
// 「재직자만」 = 퇴사 처리 안 됨 + 퇴사일이 없거나 오늘 이후(직원 목록과 같은 기준). 휴직·임시휴무는 재직으로 본다(검증 C3·P2).
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGER") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") || "", to = sp.get("to") || "";
  if (!isRealDate(from) || !isRealDate(to) || from > to) return NextResponse.json({ error: "기간을 확인해 주세요." }, { status: 400 });
  const fromD = new Date(`${from}T00:00:00Z`), toD = new Date(`${to}T00:00:00Z`);
  if ((toD.getTime() - fromD.getTime()) / 86400000 > 731) return NextResponse.json({ error: "기간은 최대 2년까지 볼 수 있습니다." }, { status: 400 });

  const wanted = (sp.get("branches") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const activeOnly = sp.get("active") === "1";
  // 원장은 담당 지점(겸직 포함) 안에서만 — 다른 지점을 골라도 담당 지점과의 교집합만 본다
  let branchIn: string[] | null = wanted.length ? wanted : null;
  if (session.role === "MANAGER") {
    const mine = await getManagerBranches(session.userId);
    branchIn = branchIn ? branchIn.filter((b) => mine.includes(b)) : mine;
  }

  const [rows, holidays] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: toD }, endDate: { gte: fromD },
        user: {
          deletedAt: null,
          ...(branchIn ? { branch: { in: branchIn } } : {}),
          ...(activeOnly ? {
            isActive: true, employmentStatus: { not: "RESIGNED" as const },
            OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }],
          } : {}),
        },
      },
      select: {
        id: true, type: true, startDate: true, endDate: true, days: true, reason: true,
        user: { select: { id: true, empNo: true, name: true, branch: true, employmentStatus: true, resignDate: true } },
      },
      orderBy: [{ startDate: "asc" }],
    }),
    getHolidaySet(fromD, toD),
  ]);

  const out = rows.map((r) => {
    const info = leaveInfo(r.type);
    const unitDays = info?.unit === "HALF" ? 0.5 : info?.unit === "QUARTER" ? 0.25 : 1;
    const s = ymdUTC(r.startDate) > from ? ymdUTC(r.startDate) : from;
    const e = ymdUTC(r.endDate) < to ? ymdUTC(r.endDate) : to;
    const byMonth: Record<string, number> = {};
    let days = 0;
    for (let d = new Date(`${s}T00:00:00Z`); ymdUTC(d) <= e; d = new Date(d.getTime() + 86400000)) {
      const ymd = ymdUTC(d), dow = d.getUTCDay();
      if (dow === 0 || dow === 6 || holidays.has(ymd)) continue;
      days += unitDays;
      byMonth[ymd.slice(0, 7)] = (byMonth[ymd.slice(0, 7)] ?? 0) + unitDays;
    }
    // 휴가 전체가 기간 안이고 한 달 안이면 저장된 일수(차감된 값)로 맞춘다
    const whole = ymdUTC(r.startDate) >= from && ymdUTC(r.endDate) <= to;
    const months = Object.keys(byMonth);
    if (whole && months.length <= 1 && r.days > 0) {
      days = r.days;
      byMonth[months[0] ?? ymdUTC(r.startDate).slice(0, 7)] = r.days;
    }
    const paidHours = info ? (days / unitDays) * info.paidHours : days * 8;
    return {
      id: r.id,
      userId: r.user.id, empNo: r.user.empNo, name: r.user.name, branch: r.user.branch,
      resigned: r.user.employmentStatus === "RESIGNED" || isResigned(r.user.resignDate),
      type: r.type, label: info?.label ?? r.type, group: info?.group ?? "기타휴가",
      startDate: ymdUTC(r.startDate), endDate: ymdUTC(r.endDate),
      days, paidHours, deductDays: info?.deducts === false ? 0 : days,
      reason: r.reason ?? "",
      byMonth,
    };
  }).filter((r) => r.days > 0);   // 기간 안에 근무일이 하루도 없으면(주말에만 걸침) 뺀다

  return NextResponse.json({ from, to, rows: out });
}
