import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { calendarVisibleWhere, dayOrderScope, dayRanks, myBranch, parseEventTimes } from "@/lib/work-calendar";

// 회사/지점 전체 일정 조회 (개인 일정 아님, 근무일정·휴가와 비연동)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const year = parseInt(searchParams.get("year") || String(new Date().getFullYear()));
  const month = parseInt(searchParams.get("month") || String(new Date().getMonth() + 1));

  // 해당 월에 걸치는 일정 (시작 ≤ 말일 && 종료 ≥ 1일)
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);

  // 전사(branch=null) + 본인 지점(원장은 담당 지점 목록 — 대표+겸직). 원장 전용(managersOnly)은 원장·관리자에게만 노출(직원 제외)
  const myBranches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : [];
  const branchFilter = calendarVisibleWhere(session, myBranches);   // 순서 바꾸기(order)와 같은 범위

  const events = await prisma.workCalendarEvent.findMany({
    where: {
      startDate: { lte: monthEnd },
      endDate: { gte: monthStart },
      ...branchFilter,
    },
    orderBy: [{ startDate: "asc" }, { startTime: { sort: "asc", nulls: "first" } }], // 같은 날은 종일 먼저, 그다음 이른 시각(#221)
  });

  // 같은 날 순서(#243) — 내 지점(관리자는 본부)이 정한 자리. 일정마다 { 날짜: 자리 } 로 싣는다
  const scope = await dayOrderScope(session);
  const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
  const from = events.length ? ymdOf(new Date(Math.min(...events.map((e) => e.startDate.getTime())))) : "";
  const to = events.length ? ymdOf(new Date(Math.max(...events.map((e) => e.endDate.getTime())))) : "";
  const stored = scope && events.length ? await dayRanks(scope, from, to) : new Map<string, Map<string, number>>();
  // 저장된 목록에는 이 사람이 못 보는 일정(원장 전용 · 다른 겸직 지점)도 있다 — 보이는 것만 남겨 0, 1, 2… 로 다시 매긴다(11/5 재검증)
  const visibleIds = new Set(events.map((e) => e.id));
  const ranks = new Map<string, Map<string, number>>();
  for (const [d, m] of stored) {
    const ids = [...m.entries()].filter(([id]) => visibleIds.has(id)).sort((a, b) => a[1] - b[1]).map(([id]) => id);
    ranks.set(d, new Map(ids.map((id, i) => [id, i])));
  }
  const rankOf = (id: string, from: Date, to: Date) => {
    const out: Record<string, number> = {};
    for (const [d, m] of ranks) {
      const r = m.get(id);
      if (r !== undefined && d >= from.toISOString().slice(0, 10) && d <= to.toISOString().slice(0, 10)) out[d] = r;
    }
    return out;
  };

  return NextResponse.json({
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      startDate: e.startDate,
      endDate: e.endDate,
      startTime: e.startTime, // null = 종일(#221)
      endTime: e.endTime,
      branch: e.branch, // null = 전사
      managersOnly: e.managersOnly,
      color: e.color,
      dayRank: rankOf(e.id, e.startDate, e.endDate), // 같은 날 순서(#243) — { "YYYY-MM-DD": 자리 }, 없는 날은 종일 먼저 · 이른 시각
      canEdit:
        session.role === "ADMIN" ||
        e.createdBy === session.userId ||
        (session.role === "MANAGER" && !e.managersOnly && !!e.branch && myBranches.includes(e.branch)),
    })),
  });
}

// 일정 등록 (관리자=전사·전지점, 원장=자기 지점만, 직원=자기 지점만 — 2026-10-20 디렉터: 지점 구성원끼리 보는 일정은 직원도 등록, 다른 지점엔 안 보임)
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const employeeBranch = session.role === "EMPLOYEE" ? await myBranch(session.userId) : null;
  if (session.role === "EMPLOYEE" && !employeeBranch)
    return NextResponse.json({ error: "소속 지점이 없어 일정을 등록할 수 없습니다." }, { status: 403 });

  const { title, description, startDate, endDate, branch, color, managersOnly, startTime, endTime } = await request.json();
  if (!title?.trim() || !startDate)
    return NextResponse.json({ error: "제목과 시작일을 입력해주세요." }, { status: 400 });
  const times = parseEventTimes(startTime, endTime, !endDate || endDate === startDate); // #221 시각(선택)
  if ("error" in times) return NextResponse.json({ error: times.error }, { status: 400 });

  // 원장 전용 일정: branch 없이 전 원장 대상 (관리자·원장 모두 등록 가능)
  // 일반 일정: 원장은 자기 지점만 등록 가능 (전사 일정 불가)
  const isManagersOnly = session.role !== "EMPLOYEE" && !!managersOnly; // 직원은 원장 전용을 만들 수 없다
  let finalBranch: string | null = branch || null;
  if (isManagersOnly) {
    finalBranch = null;
  } else if (session.role === "MANAGER") {
    // 소속 지점이 없는 원장이 보내면 전사 일정이 되어 버린다 — 화면만 막고 있던 것을 서버에서도(2026-10-30 검증)
    if (!session.branch) return NextResponse.json({ error: "소속 지점이 없어 지점 일정을 등록할 수 없습니다." }, { status: 400 });
    finalBranch = session.branch;
  } else if (session.role === "EMPLOYEE") {
    finalBranch = employeeBranch; // 직원은 자기 지점 고정(전사 일정 불가)
  }

  const event = await prisma.workCalendarEvent.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      startDate: new Date(startDate),
      endDate: new Date(endDate || startDate),
      startTime: times.startTime,
      endTime: times.endTime,
      branch: finalBranch,
      managersOnly: isManagersOnly,
      color: color || "indigo",
      createdBy: session.userId,
    },
  });
  return NextResponse.json({ success: true, event });
}
