import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { countableEmployeeWhere, isManagerRow } from "@/lib/employee-scope";
import { kstTodayMidnight } from "@/lib/resign";
import { hiddenWhere } from "@/lib/hidden-accounts";
import { endOfMonth, endOfYear } from "date-fns";

export async function GET(request: NextRequest) {
  try {
    // 요청 헤더 로깅

    const session = await getSession();
    if (!session) {
      return NextResponse.json(
        { error: "인증이 필요합니다." },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "month"; // month | year
    const dateParam = searchParams.get("date"); // "2026-05" | "2026"

    // 관리자(서브 포함)는 본부 소속이라 기본 제외. 화면의 "관리자 포함" 체크 시에만 넣는다
    const includeAdmins =
      searchParams.get("includeAdmins") === "true" && session.role === "ADMIN";


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

    // 권한별 지점 필터 (원장: 담당 지점 목록 — 대표+겸직)
    const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];

    // 대상 일자 기준 재직자 조회

    let employees;
    try {
      // 인원 숫자 공용 기준(lib/employee-scope, 2026-10-23 ■0-9 · ■3) — 전체 직원 = 지점 재직 + 휴직.
      // 관리자 · 통계 제외 지점(본부 · 테스트지점) · 소속 없음 · 퇴사자 · 테스트 계정은 세지 않는다. 「관리자 포함」이면 관리자는 소속과 무관하게 넣는다.
      // 대상 일자 기준: 그날까지 입사(입사일 미입력 포함) · 그날 뒤 퇴사(퇴사일이 대상 일자보다 뒤)
      // 기준일 = 대상 기간의 끝 — 이번 달(올해)처럼 끝이 오늘 뒤면 오늘(10/23 검증 H: 대시보드 · 인사 › 직원과 같은 숫자).
      //   그 기간 안에 퇴사 예정인 사람은 오늘까지 재직으로 세고, 입사일이 오늘보다 뒤(입사 예정)인 사람은 뺀다
      const today = kstTodayMidnight();
      const isNow = targetEndDate.getTime() + 1 > today.getTime();
      const baseWhere = await countableEmployeeWhere({
        scope: "all", includeAdmins,
        activeOn: isNow ? today : new Date(targetEndDate.getTime() + 1),
        hiredBy: isNow ? today : targetEndDate,
        ...(session.role === "MANAGER" ? { branches: myBranches } : {}),
      });
      employees = await prisma.user.findMany({
        where: {
          AND: [
            baseWhere,
            { OR: [{ hireDate: null }, { hireDate: { lte: targetEndDate } }] },
            // 「관리자 포함」을 켜도 개발자 영역(메인 관리자)은 보는 사람에게만(2026-10-17 디렉터)
            await hiddenWhere(session),
          ],
        },
        select: {
          id: true,
          name: true,
          jobGroup: true,
          position: true,
          branch: true,
          employmentStatus: true,
        },
      });
    } catch (queryError) {
      console.error("[STATS ACTIVE] Query error:", queryError);
      throw queryError;
    }

    // 직군별 집계 (기본 직군 + 실제 데이터의 직군을 동적으로 포함)
    const byPosition: Record<string, number> = {
      "원장": 0,
      "CM": 0,
      "TM": 0,
      "코디": 0,
    };

    // 지점별 집계
    const byBranch: Record<string, { total: number; [key: string]: number }> = {};

    // 「원장」 칸은 원장 판정 공용 함수(lib/employee-scope isManagerRow — 직급 원장 · 대표원장 또는 직군 원장, 10/23 검증 H)
    employees.forEach((emp) => {
      const pos = isManagerRow(emp) ? "원장" : (emp.jobGroup ?? "").trim() || "미정";

      byPosition[pos] = (byPosition[pos] || 0) + 1;

      // 지점별 집계 — 소속 지점이 없으면 따로 묶는다(지점별 합계가 총원과 어긋나지 않게)
      const bKey = emp.branch || "(지점 미지정)";
      if (!byBranch[bKey]) {
        byBranch[bKey] = { total: 0 };
      }
      byBranch[bKey].total++;
      byBranch[bKey][pos] = (byBranch[bKey][pos] || 0) + 1;
    });

    const total = employees.length;
    const onLeave = employees.filter((e) => e.employmentStatus !== "ACTIVE").length;   // 휴직(임시휴무 포함) — 전체 직원에 들어 있다

    return NextResponse.json({
      total,
      onLeave,
      managers: byPosition["원장"],   // 원장(직급 원장) — headcount.managers 와 같은 기준
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
