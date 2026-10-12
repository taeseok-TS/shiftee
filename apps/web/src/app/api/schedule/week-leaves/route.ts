import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { isRealDate } from "@/lib/schedule-payload";
import { mondayOf } from "@/lib/weekly-hours";
import { getHolidaySet, ymdUTC } from "@/lib/holidays";
import { leaveLabel } from "@/lib/leave-catalog";

export const dynamic = "force-dynamic";

// 근무일정 주간 표에 휴가 함께 보기(2026-10-07 QA #61) — 그 주에 걸친 **승인된** 휴가를 사람·날짜별로
// GET ?week=YYYY-MM-DD(그 주 아무 날) → { monday, from, to, leaves: { [userId]: { [date]: { type, label }[] } } }
// GET ?start=YYYY-MM-DD&end=YYYY-MM-DD → 그 기간(62일까지). 일·주·월 보기(#71)가 쓴다. monday 는 from 과 같다
// 주말·공휴일은 휴가 일수에 들지 않으므로 그날에는 표시하지 않는다(휴가 신청 일수 계산과 같은 기준).
const MAX_DAYS = 62;
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGER") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const sp = new URL(request.url).searchParams;
  let fromYmd: string, dayCount: number;
  if (sp.has("start") || sp.has("end")) {
    const s = sp.get("start") || "", e = sp.get("end") || "";
    if (!isRealDate(s) || !isRealDate(e)) return NextResponse.json({ error: "기간을 확인해 주세요. (YYYY-MM-DD)" }, { status: 400 });
    const diff = Math.round((Date.parse(e) - Date.parse(s)) / 86400000);
    if (diff < 0) return NextResponse.json({ error: "시작일이 종료일보다 늦습니다." }, { status: 400 });
    if (diff + 1 > MAX_DAYS) return NextResponse.json({ error: `한 번에 ${MAX_DAYS}일까지 조회할 수 있습니다.` }, { status: 400 });
    fromYmd = s; dayCount = diff + 1;
  } else {
    const week = sp.get("week") || "";
    if (!isRealDate(week)) return NextResponse.json({ error: "날짜를 확인해 주세요." }, { status: 400 });
    fromYmd = mondayOf(week); dayCount = 7;
  }
  const monday = fromYmd;
  const [y, m, d] = fromYmd.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, d)), to = new Date(Date.UTC(y, m - 1, d + dayCount - 1));

  // 원장은 담당 지점(겸직 포함) 직원만, 휴지통 계정은 뺀다(휴가 목록과 같은 기준)
  const user = session.role === "MANAGER"
    ? { deletedAt: null, branch: { in: await getManagerBranches(session.userId) } }
    : { deletedAt: null };
  const [rows, holidays] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: to }, endDate: { gte: from }, user },
      select: { userId: true, type: true, startDate: true, endDate: true },
    }),
    getHolidaySet(from, to),
  ]);

  const leaves: Record<string, Record<string, { type: string; label: string }[]>> = {};
  for (const r of rows) {
    const s = ymdUTC(r.startDate), e = ymdUTC(r.endDate);
    for (let i = 0; i < dayCount; i++) {
      const day = new Date(Date.UTC(y, m - 1, d + i));
      const ymd = ymdUTC(day);
      if (ymd < s || ymd > e) continue;
      const dow = day.getUTCDay();
      if (dow === 0 || dow === 6 || holidays.has(ymd)) continue;
      ((leaves[r.userId] ??= {})[ymd] ??= []).push({ type: r.type, label: leaveLabel(r.type) });
    }
  }
  return NextResponse.json({ monday, from: fromYmd, to: ymdUTC(to), leaves });
}
