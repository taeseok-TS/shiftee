import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { kstHour, kstMinute } from "@/lib/kst";
import { testRequesterExclusion } from "@/lib/employee-scope";

export const dynamic = "force-dynamic";

// 출퇴근 위치 판정 시도 기록(2026-10-27 이예지 「지점 밖 판정」) — 본부 전용. 출퇴근 현황 「지점 밖 · 위치 실패」 탭이 쓴다.
//  GET ?from=YYYY-MM-DD&to=YYYY-MM-DD(KST, 기본 최근 7일)&branch=&fail=1(실패만)
//  → rows(날짜 · 시각 · 직원 · 지점 · 거리 · 오차 · 인정 거리 · 결과 · 기기 · OS · 앱 버전) + repeat(실패 2회 이상 직원) + byBranch(지점별 실패 수)
//  좌표 숫자는 내려보내지 않는다(거리 · 오차만) — 본부 요청 「좌표 숫자는 빼고」
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const kstDayStartUtc = (ymd: string) => new Date(`${ymd}T00:00:00+09:00`);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  const sp = request.nextUrl.searchParams;
  const todayKst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const to = YMD.test(sp.get("to") || "") ? (sp.get("to") as string) : todayKst;
  const fromDefault = new Date(kstDayStartUtc(to).getTime() - 6 * 86400_000 + 9 * 3600_000).toISOString().slice(0, 10);
  const from = YMD.test(sp.get("from") || "") ? (sp.get("from") as string) : fromDefault;
  if (from > to || Number.isNaN(kstDayStartUtc(from).getTime()) || Number.isNaN(kstDayStartUtc(to).getTime())) return NextResponse.json({ error: "기간을 확인해 주세요." }, { status: 400 });
  if (kstDayStartUtc(to).getTime() - kstDayStartUtc(from).getTime() > 92 * 86400_000) return NextResponse.json({ error: "한 번에 3개월까지 볼 수 있습니다." }, { status: 400 });
  const branch = (sp.get("branch") || "").trim();
  const failOnly = sp.get("fail") === "1";

  // 테스트 계정 시도는 결재함과 같은 규칙으로 뺀다(?includeTest=1 이면 넣는다) — 라이브 검증이 「반복 직원」 1위에 뜨지 않게
  const testEx = await testRequesterExclusion(session, sp.get("includeTest"));
  const rows = await prisma.geofenceAttempt.findMany({
    where: {
      at: { gte: kstDayStartUtc(from), lt: new Date(kstDayStartUtc(to).getTime() + 86400_000) },
      ...(testEx ? { user: testEx } : {}),
      ...(failOnly ? { result: { not: "OK" } } : {}),
      ...(branch ? { OR: [{ branch }, { user: { branch } }] } : {}),
    },
    select: {
      id: true, at: true, action: true, accuracy: true, branch: true, distance: true, radius: true, result: true, deviceId: true, platform: true, appVersion: true,
      user: { select: { id: true, name: true, branch: true, position: true } },
    },
    orderBy: { at: "desc" },
    take: 2000,
  });
  const hhmm = (d: Date) => `${String(kstHour(d)).padStart(2, "0")}:${String(kstMinute(d)).padStart(2, "0")}`;
  const ymdOf = (d: Date) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const out = rows.map((r) => ({
    id: r.id, date: ymdOf(r.at), time: hhmm(r.at), action: r.action,
    userId: r.user.id, name: r.user.name, userBranch: r.user.branch, position: r.user.position,
    branch: r.branch, distance: r.distance, accuracy: r.accuracy == null ? null : Math.round(r.accuracy), radius: r.radius,
    result: r.result,
    // 기기 번호는 끝 4자리만(사람 구분용) — 전체 번호는 기기 잠금 쪽에서만
    device: r.deviceId ? `…${r.deviceId.slice(-4)}` : null, platform: r.platform, appVersion: r.appVersion,
  }));
  // 반복 실패 직원 — 기간 안 실패(OUTSIDE · NO_LOCATION) 2회 이상
  const fails = out.filter((r) => r.result !== "OK");
  const byUser = new Map<string, { userId: string; name: string; branch: string | null; fails: number; days: Set<string>; lastDistance: number | null; maxAccuracy: number | null }>();
  for (const r of fails) {
    const u = byUser.get(r.userId) ?? { userId: r.userId, name: r.name, branch: r.userBranch, fails: 0, days: new Set<string>(), lastDistance: null, maxAccuracy: null };
    u.fails++; u.days.add(r.date);
    if (u.lastDistance == null) u.lastDistance = r.distance;   // 최신순이라 처음 만난 것이 마지막 실패
    if (r.accuracy != null) u.maxAccuracy = Math.max(u.maxAccuracy ?? 0, r.accuracy);
    byUser.set(r.userId, u);
  }
  const repeat = [...byUser.values()].filter((u) => u.fails >= 2).map((u) => ({ ...u, days: u.days.size })).sort((a, b) => b.fails - a.fails);
  const byBranchMap = new Map<string, { branch: string; fails: number; ok: number; people: Set<string> }>();
  for (const r of out) {
    const b = r.userBranch || r.branch || "(지점 없음)";
    const row = byBranchMap.get(b) ?? { branch: b, fails: 0, ok: 0, people: new Set<string>() };
    if (r.result === "OK") row.ok++; else { row.fails++; row.people.add(r.userId); }
    byBranchMap.set(b, row);
  }
  const byBranch = [...byBranchMap.values()].map((b) => ({ branch: b.branch, fails: b.fails, ok: b.ok, people: b.people.size })).sort((a, b) => b.fails - a.fails || a.branch.localeCompare(b.branch, "ko"));
  // 지점 고르기용 전체 지점(오늘 인원이 없는 지점도) — 통계 포함 · 운영 중만
  const branches = (await prisma.branch.findMany({ where: { isActive: true, countInStats: true }, select: { name: true }, orderBy: { name: "asc" } })).map((b) => b.name);
  return NextResponse.json({ from, to, rows: out, repeat, byBranch, branches, truncated: rows.length >= 2000 });
}
