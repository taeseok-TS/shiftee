import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { countableEmployeeWhere } from "@/lib/employee-scope";


// 좌표 칸 검사 — 빈칸을 Number("") 로 바꾸면 **0, 0** 이 저장돼 그 지점 직원 전원의 출근이 막혔다(2026-10-06 QA 조사).
// undefined = 손대지 않음, null = 좌표 지우기(위치 검사 꺼짐 — 등록·수정 알림이 그 사실을 알린다), 그 밖엔 올바른 숫자만.
function parseCoord(v: unknown, kind: "lat" | "lng"): number | null | undefined | "bad" {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string" && v.trim() === "") return "bad";
  const n = Number(v);
  const lim = kind === "lat" ? 90 : 180;
  if (n === 0) return null; // 0 은 좌표가 아니다 — 옛 버그로 0,0 이 저장된 지점이 있어 「없음」으로 다룬다(검증관 C1)
  if (!Number.isFinite(n) || Math.abs(n) > lim) return "bad";
  return n;
}

// 숨긴 지점(2026-10-23 본부 요청 ■0-8 · 시안 S5) = 지점 관리에서 「숨긴 지점」(countInStats=false)으로 둔 지점 — 테스트지점.
// 본부도 인원 숫자에서는 빠지지만(countInStats=false) 지점 고르기에서는 남긴다(본부 직원 · 본부 일정을 고를 일이 있다).
// ?pick=1 = 다른 화면의 「지점 고르기」용 — 숨긴 지점을 뺀다. 지점 관리 · 직원 수정 창처럼 모든 지점이 필요한 곳은 그대로(파라미터 없이).
// ?pick=1&includeTest=1 = 「테스트 포함」을 켠 화면의 지점 고르기 — 숨긴 지점(테스트지점)도 넣는다(2026-10-23 이예지 답, 라이브 검증용).
// 인원 배지(_count.users) = 지점 직원(재직 · 휴직 빼고) — 인원 숫자 공용 기준(lib/employee-scope countableEmployeeWhere)과 같다:
//   관리자 · 테스트 계정 · 퇴사일 지난 사람 · 입사 예정자는 세지 않고, 숨긴 지점(본부 · 테스트지점)은 0(10/23 검증 H).
const HQ_BRANCH_NAME = "본부";
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  if (session.role === "EMPLOYEE") {
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  }

  try {
    const sp = new URL(request.url).searchParams;
    const pick = sp.get("pick") === "1";
    const includeTest = sp.get("includeTest") === "1";
    const branches = await prisma.branch.findMany({
      where: { isActive: true, ...(pick && !includeTest ? { OR: [{ countInStats: true }, { name: HQ_BRANCH_NAME }] } : {}) },
      orderBy: { name: "asc" },
      // 메인 원장 — 한 지점에 원장이 2명일 때 누가 상급인지(결재 방향을 정한다)
      include: { mainManager: { select: { id: true, name: true } } },
    });

    // 지점별 직원 수 — 공용 기준 한 번에 묶어 센다
    const counted = await prisma.user.groupBy({
      by: ["branch"],
      where: await countableEmployeeWhere({ scope: "staff" }),
      _count: { _all: true },
    });
    const countOf = new Map(counted.map((c) => [c.branch, c._count._all]));
    const branchesWithCount = branches.map((branch) => ({
      ...branch,
      _count: { users: countOf.get(branch.name) ?? 0 },
    }));

    return NextResponse.json({ branches: branchesWithCount });
  } catch (error) {
    console.error("지점 조회 실패:", error);
    return NextResponse.json({ error: "지점을 조회할 수 없습니다." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN")
    return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { name, address, latitude, longitude, radius } = await request.json();
  if (!name) return NextResponse.json({ error: "지점명은 필수입니다." }, { status: 400 });
  // 빈칸·잘못된 좌표는 받지 않는다(빈칸이 0,0 으로 저장되던 문제, 2026-10-06). 좌표 없이 등록은 그대로 된다(null).
  const lat = parseCoord(latitude === "" ? null : latitude, "lat"), lng = parseCoord(longitude === "" ? null : longitude, "lng");
  if (lat === "bad" || lng === "bad" || (lat ?? null) === null !== ((lng ?? null) === null))
    return NextResponse.json({ error: "위도·경도를 숫자로 둘 다 입력해 주세요. (예: 37.4979, 127.0276)" }, { status: 400 });

  const existing = await prisma.branch.findUnique({ where: { name } });
  if (existing) return NextResponse.json({ error: "이미 존재하는 지점명입니다." }, { status: 409 });

  const branch = await prisma.branch.create({
    data: {
      name,
      address: address || null,
      latitude: lat ?? null,
      longitude: lng ?? null,
      radius: radius ? Number(radius) : 100,
    },
  });
  // 담당자(관리자·본부장)에게 알린다. 좌표가 없으면 그 지점은 **위치 검사가 통째로 꺼지므로**
  // 알림 본문이 그 사실을 명시한다 (2026-09-07 디렉터 지시).
  // 응답 뒤에 보낸다 — 알림 실패가 지점 등록을 되돌리면 안 된다.
  void (async () => {
    const { notifyBranchChange } = await import("@/lib/branch-notify");
    await notifyBranchChange("created", branch, session.name);
  })();

  return NextResponse.json({ success: true, branch });
}
