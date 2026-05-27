import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { endOfMonth, endOfYear } from "date-fns";

export async function GET(request: NextRequest) {
  try {
    // 요청 헤더 로깅
    const cookieHeader = request.headers.get("cookie");
    console.log("[STATS ACTIVE] Request cookie header:", cookieHeader ? "YES" : "NO");
    if (cookieHeader) {
      console.log("[STATS ACTIVE] Cookie value (first 50):", cookieHeader.substring(0, 50));
    }

    const session = await getSession();
    console.log("[STATS ACTIVE] Session:", session?.userId || "NO SESSION");
    if (!session) {
      console.log("[STATS ACTIVE] No session found, returning 401");
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "month"; // month | year
    const dateParam = searchParams.get("date"); // "2026-05" | "2026"

    // 기본값: 현재 월/년
    let targetDate: Date;
    if (!dateParam) {
      targetDate = new Date();
    } else {
      if (period === "year") {
        // "2026"
        const year = parseInt(dateParam);
        targetDate = new Date(year, 0, 1);
      } else {
        // "2026-05"
        const [year, month] = dateParam.split("-");
        targetDate = new Date(parseInt(year), parseInt(month) - 1, 1);
      }
    }

    // 대상 일자 결정
    let targetEndDate: Date;
    if (period === "year") {
      targetEndDate = endOfYear(targetDate);
    } else {
      targetEndDate = endOfMonth(targetDate);
    }

    // 권한별 지점 필터
    const branchFilter =
      session.role === "MANAGER" ? session.branch : undefined;

    // 대상 일자 기준 재직자 조회
    console.log("[STATS ACTIVE] Query params:", { period, dateParam, targetEndDate });

    let employees;
    try {
      employees = await prisma.user.findMany({
        where: {
          AND: [
            { hireDate: { lte: targetEndDate } },
            {
              OR: [
                { resignDate: null },
                { resignDate: { gt: targetEndDate } },
              ],
            },
            { employmentStatus: "ACTIVE" },
            ...(branchFilter ? [{ branch: branchFilter }] : []),
          ],
        },
        select: {
          id: true,
          name: true,
          jobGroup: true,
          position: true,
          branch: true,
        },
      });
      console.log("[STATS ACTIVE] Query succeeded, count:", employees.length);
    } catch (queryError) {
      console.error("[STATS ACTIVE] Query error:", queryError);
      throw queryError;
    }

    // 직급별 집계
    const byPosition: Record<string, number> = {
      "원장": 0,
      "CM": 0,
      "TM": 0,
      "코디": 0,
    };

    // 지점별 집계
    const byBranch: Record<
      string,
      { total: number; "원장": number; CM: number; TM: number; 코디: number }
    > = {};

    employees.forEach((emp) => {
      const pos = emp.jobGroup || "미정";

      // byPosition 증가 (알려진 직급만)
      if (byPosition.hasOwnProperty(pos)) {
        byPosition[pos]++;
      }

      // 지점별 집계
      if (emp.branch) {
        if (!byBranch[emp.branch]) {
          byBranch[emp.branch] = {
            total: 0,
            "원장": 0,
            CM: 0,
            TM: 0,
            코디: 0,
          };
        }

        byBranch[emp.branch].total++;

        // 알려진 직급인 경우에만 증가
        if (byPosition.hasOwnProperty(pos)) {
          (byBranch[emp.branch] as any)[pos]++;
        }
      }
    });

    const total = employees.length;

    console.log("[STATS ACTIVE] Success - Total employees:", total);
    return NextResponse.json({
      total,
      byPosition,
      byBranch,
      date: targetEndDate.toISOString().split("T")[0],
      period,
      employees,
    });
  } catch (error) {
    console.error("STATS ACTIVE ERROR:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : "";
    console.error("Error details:", { errorMessage, errorStack });

    return NextResponse.json(
      { error: "서버 오류가 발생했습니다.", details: errorMessage },
      { status: 500 }
    );
  }
}
