import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { isRealDate } from "@/lib/schedule-payload";
import { ymdUTC } from "@/lib/holidays";
import { leaveDayWeightsMany, weightsIn, approvedDaysByYear, alignWeightsToYears } from "@/lib/leave-days";
import { leaveInfo } from "@/lib/leave-catalog";
import { ensureLeaveCatalog } from "@/lib/leave-catalog-db";
import { isLeaveDeductible } from "@/lib/leave-types";
import { kstTodayMidnight, isResigned } from "@/lib/resign";
import { testAccountWhere } from "@/lib/employee-scope";

export const dynamic = "force-dynamic";

// 휴가 사용 내역 리포트(2026-10-07 QA #29 #84 #85) — 기간·지점(여러 개)·재직자만으로 **승인된** 휴가를 뽑는다.
// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD[&branches=대치,평촌][&active=1]
// 기간에 걸친 휴가는 **기간 안의 날만** 센다(9/29~10/2 휴가를 10월로 뽑으면 10/1·10/2 만). 날마다 몫은 차감·연차 대장·정산과
// **같은 나눔**(lib/leave-days leaveDayWeights — 근무일정 기준 근무일 하루 1일, 합은 저장된 일수, 2026-10-19 연도를 걸친 휴가 날짜별 귀속)을
// 차감 때 저장한 해마다 몫(deductedByYear)에 맞춘 것(alignWeightsToYears).
// 그래서 휴가 전체가 기간 안이면 언제나 **저장된 일수**(실제 차감된 값)와 같다(검증 P1). 반차·반반차는 그날 0.5·0.25일.
// 유급 시간 = 일수 × 기준표 하루 유급 시간(반차는 반차 시간). byMonth 는 월별 보기(#84)용 — 달마다 일수.
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

  await ensureLeaveCatalog();   // 본부가 만든 유형(#216-1)의 차감 여부까지 보게(적재 전이면 차감 안 하는 쪽 — lib/leave-types)
  const rows = await prisma.leaveRequest.findMany({
    where: {
      status: "APPROVED",
      startDate: { lte: toD }, endDate: { gte: fromD },
      user: {
        deletedAt: null,
        NOT: await testAccountWhere(),   // 테스트 계정은 휴가 리포트에서 뺀다(2026-10-23 검증 I)
        ...(branchIn ? { branch: { in: branchIn } } : {}),
        ...(activeOnly ? {
          isActive: true, employmentStatus: { not: "RESIGNED" as const },
          OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }],
        } : {}),
      },
    },
    select: {
      id: true, type: true, startDate: true, endDate: true, days: true, reason: true, deductedByYear: true,
      user: { select: { id: true, empNo: true, name: true, branch: true, employmentStatus: true, resignDate: true } },
    },
    orderBy: [{ startDate: "asc" }],
  });
  const weightsOf = await leaveDayWeightsMany(prisma, rows.map((r) => ({ id: r.id, userId: r.user.id, startDate: r.startDate, endDate: r.endDate, days: r.days, type: r.type })));

  const out = rows.map((r) => {
    const info = leaveInfo(r.type);
    const unitDays = info?.unit === "HALF" ? 0.5 : info?.unit === "QUARTER" ? 0.25 : 1;
    // 연차 차감 유형만 날짜 몫(지금 나눔)을 **차감 때 저장한 해마다 몫**(없으면 옛 규칙 — 시작 해에 days)에 맞춘다 — 해마다 합이 잔여·대장·정산과 같다.
    // 차감하지 않는 유형(무급·예비군·대체휴일 등)은 deductLeave 를 안 거쳐 저장값이 없으므로 날짜 몫(근무일정 기준) 그대로
    const w0 = weightsOf.get(r.id) ?? new Map<string, number>();
    const w = isLeaveDeductible(r.type) ? alignWeightsToYears(w0, approvedDaysByYear(r), ymdUTC(r.startDate)) : w0;
    const days = weightsIn(w, from, to);
    const byMonth: Record<string, number> = {};
    for (const [ymd, n] of w) {
      if (ymd < from || ymd > to) continue;
      const m = ymd.slice(0, 7);
      byMonth[m] = Math.round(((byMonth[m] ?? 0) + n) * 1e9) / 1e9;   // 부동소수 찌꺼기만 지운다(종전처럼 반올림하지 않음)
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
