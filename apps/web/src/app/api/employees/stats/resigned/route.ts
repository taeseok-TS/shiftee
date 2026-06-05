import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";

export async function GET(request: NextRequest) {
  try {
    // 요청 헤더 로깅
    const cookieHeader = request.headers.get("cookie");
    console.log("[STATS RESIGNED] Request cookie header:", cookieHeader ? "YES" : "NO");
    if (cookieHeader) {
      console.log("[STATS RESIGNED] Cookie value (first 50):", cookieHeader.substring(0, 50));
    }

    const session = await getSession();
    console.log("[STATS RESIGNED] Session:", session?.userId || "NO SESSION");
    if (!session) {
      console.log("[STATS RESIGNED] No session found, returning 401");
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const monthParam = searchParams.get("month"); // "2026-05"
    const yearParam = searchParams.get("year"); // "2026"

    // 권한별 지점 필터
    const branchFilter =
      session.role === "MANAGER" ? session.branch : undefined;

    if (monthParam) {
      // 월간 조회
      const [year, month] = monthParam.split("-");
      const monthDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      const monthStart = startOfMonth(monthDate);
      const monthEnd = endOfMonth(monthDate);

      const resignedEmployees = await prisma.user.findMany({
        where: {
          AND: [
            { employmentStatus: "RESIGNED" },
            { resignDate: { gte: monthStart, lte: monthEnd } },
            { role: { not: "ADMIN" } },
            ...(branchFilter ? [{ branch: branchFilter }] : []),
          ],
        },
        select: {
          id: true,
          name: true,
          jobGroup: true,
          position: true,
          branch: true,
          hireDate: true,
          resignDate: true,
          resignReason: true,
        },
        orderBy: { resignDate: "desc" },
      });

      return NextResponse.json({
        month: monthParam,
        total: resignedEmployees.length,
        employees: resignedEmployees,
      });
    } else if (yearParam) {
      // 연간 조회
      const year = parseInt(yearParam);
      const yearDate = new Date(year, 0, 1);
      const yearStart = startOfYear(yearDate);
      const yearEnd = endOfYear(yearDate);

      // 전체 퇴직자 조회
      const allResigned = await prisma.user.findMany({
        where: {
          AND: [
            { employmentStatus: "RESIGNED" },
            { resignDate: { gte: yearStart, lte: yearEnd } },
            { role: { not: "ADMIN" } },
            ...(branchFilter ? [{ branch: branchFilter }] : []),
          ],
        },
        select: {
          jobGroup: true,
          resignDate: true,
        },
      });

      // 월별/직급별 집계
      const byMonth: Record<
        string,
        { total: number; "원장": number; CM: number; TM: number; 코디: number }
      > = {};
      const byPosition: Record<string, number> = {
        "원장": 0,
        CM: 0,
        TM: 0,
        코디: 0,
      };

      allResigned.forEach((emp) => {
        const pos = emp.jobGroup || "미정";
        const monthKey = emp.resignDate
          ? emp.resignDate.toISOString().substring(0, 7)
          : null;

        if (monthKey) {
          if (!byMonth[monthKey]) {
            byMonth[monthKey] = {
              total: 0,
              "원장": 0,
              CM: 0,
              TM: 0,
              코디: 0,
            };
          }
          byMonth[monthKey].total++;
          if (byPosition.hasOwnProperty(pos)) {
            byMonth[monthKey][pos]++;
          }
        }

        if (byPosition.hasOwnProperty(pos)) {
          byPosition[pos]++;
        }
      });

      // 전체 12개월 기본 구조 생성
      for (let m = 1; m <= 12; m++) {
        const monthKey = `${yearParam}-${String(m).padStart(2, "0")}`;
        if (!byMonth[monthKey]) {
          byMonth[monthKey] = {
            total: 0,
            "원장": 0,
            CM: 0,
            TM: 0,
            코디: 0,
          };
        }
      }

      // 월별로 정렬
      const sortedByMonth = Object.entries(byMonth)
        .sort(([a], [b]) => a.localeCompare(b))
        .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

      return NextResponse.json({
        year: yearParam,
        total: allResigned.length,
        byMonth: sortedByMonth,
        byPosition,
      });
    } else {
      // 기본값: 현재 년도
      const now = new Date();
      const currentYear = now.getFullYear().toString();
      return NextResponse.redirect(
        new URL(
          `/api/employees/stats/resigned?year=${currentYear}`,
          request.url
        )
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    console.error("STATS RESIGNED ERROR:", { errorMessage, errorStack });

    return NextResponse.json(
      { error: "서버 오류가 발생했습니다.", details: errorMessage },
      { status: 500 }
    );
  }
}
