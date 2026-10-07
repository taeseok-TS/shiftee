import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { excludedBranchNames } from "@/lib/employee-scope";
import { getHolidaySet } from "@/lib/holidays";
import { breakHours, isRealDate } from "@/lib/schedule-payload";

export const dynamic = "force-dynamic";

// 주말 근무 엑셀(2026-10-07 QA #86) — 본부가 보낸 양식 「직영점 주말근무(2026.09).xlsx」 그대로.
//  · 제목 「직영 재직자 급여 자료 - 주말 근무」, 「산출기간: 26.08.20~26.09.19 사이 주말」
//  · 열: 사원번호 / 직원 / 조직 / 직무 / 날짜 / 출근·퇴근(실제 기록) / 출근·퇴근(근무 일정) / 휴게시간(근무일정) / 근무인정시간(근무일정)
//  · 주말 = 토·일 + 공휴일(양식 예시에 8/17 대체공휴일이 들어 있다). 원장 포함, 관리자·통계 제외 지점 제외
//  · 근무인정시간 = 근무일정 시간 − 휴게(근무일정 신청과 같은 규칙: 4.5시간↑ 30분, 9시간↑ 60분)
//  · 기본 기간 = 전월 20일 ~ 당월 19일(화면이 정해 보낸다)
// 급여 자료라 본부만 받는다.

const dateOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
/** "08:00" → "오전 8:00" (양식 표기) */
const ampm = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")}`;
};
/** 실제 시각 → 엑셀 시각 값(하루의 비율, KST) */
const excelTime = (t: Date) => {
  const k = new Date(t.getTime() + 9 * 3600_000);
  return (k.getUTCHours() * 3600 + k.getUTCMinutes() * 60 + k.getUTCSeconds()) / 86400;
};

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const from = sp.get("from") || "", to = sp.get("to") || "";
  if (!isRealDate(from) || !isRealDate(to) || from > to) return NextResponse.json({ error: "기간을 확인해 주세요." }, { status: 400 });
  if (dateOf(to).getTime() - dateOf(from).getTime() > 93 * 86400_000) return NextResponse.json({ error: "한 번에 3개월까지 받을 수 있습니다." }, { status: 400 });
  const fromD = dateOf(from), toD = dateOf(to);

  const holidays = await getHolidaySet(fromD, toD);
  const weekendDays: Date[] = [];
  for (let d = new Date(fromD); d <= toD; d.setUTCDate(d.getUTCDate() + 1)) {
    const w = d.getUTCDay();
    if (w === 0 || w === 6 || holidays.has(ymdOf(d))) weekendDays.push(new Date(d));
  }

  const excluded = await excludedBranchNames();
  const userWhere = {
    deletedAt: null, role: { not: "ADMIN" as const },
    ...(excluded.length ? { OR: [{ branch: null }, { branch: { notIn: excluded } }] } : {}),
  };
  const [schedules, atts] = weekendDays.length
    ? await Promise.all([
        prisma.schedule.findMany({ where: { date: { in: weekendDays }, type: "WORK", user: userWhere }, select: { userId: true, date: true, startTime: true, endTime: true } }),
        prisma.attendance.findMany({ where: { date: { in: weekendDays }, clockIn: { not: null }, user: userWhere }, select: { userId: true, date: true, clockIn: true, clockOut: true } }),
      ])
    : [[], []];

  const key = (u: string, d: Date) => `${u}|${ymdOf(d)}`;
  const rowsMap = new Map<string, { userId: string; date: Date; sched?: { s: string; e: string }; att?: { in: Date | null; out: Date | null } }>();
  for (const s of schedules) rowsMap.set(key(s.userId, s.date), { userId: s.userId, date: s.date, sched: { s: s.startTime, e: s.endTime } });
  for (const a of atts) {
    const k = key(a.userId, a.date);
    const r = rowsMap.get(k) ?? { userId: a.userId, date: a.date };
    r.att = { in: a.clockIn, out: a.clockOut };
    rowsMap.set(k, r);
  }
  const userIds = [...new Set([...rowsMap.values()].map((r) => r.userId))];
  const users = new Map(
    (userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, empNo: true, branch: true, position: true, jobGroup: true } }) : [])
      .map((u) => [u.id, u]),
  );
  const rows = [...rowsMap.values()]
    .filter((r) => users.has(r.userId))
    .sort((a, b) => {
      const ua = users.get(a.userId)!, ub = users.get(b.userId)!;
      return (ua.branch ?? "").localeCompare(ub.branch ?? "") || ua.name.localeCompare(ub.name) || a.date.getTime() - b.date.getTime();
    });

  // ── 양식 그대로: 1행 비움, 2행 제목, 3행 산출기간, 4행 머리글, 5행부터 자료 ──
  const yy = (ymd: string) => ymd.slice(2).replace(/-/g, ".");
  const aoa: (string | number | Date | null)[][] = [
    [],
    ["직영 재직자 급여 자료 - 주말 근무"],
    [`산출기간: ${yy(from)}~${yy(to)} 사이 주말`],
    ["사원번호", "직원", "조직", "직무", "날짜", "출근시간\n(실제 기록)", "퇴근시간\n(실제 기록)", "출근시간\n(근무 일정)", "퇴근시간\n(근무 일정)", "휴게시간\n(근무일정)", "근무인정시간\n(근무일정)"],
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  let r = 4;   // 0부터 센 행 번호 — 5행
  for (const row of rows) {
    const u = users.get(row.userId)!;
    const emp: number | string = u.empNo ?? "";
    let breakText = "", recognized: number | null = null;
    if (row.sched) {
      const span = toMin(row.sched.e) - toMin(row.sched.s);
      if (span > 0) {
        const br = Math.round(breakHours(span / 60) * 60);
        breakText = br ? `${br}분` : "";
        recognized = (span - br) / 1440;   // 엑셀 시간 값(하루 비율)
      }
    }
    const cells: Record<number, XLSX.CellObject> = {
      0: typeof emp === "number" ? { t: "n", v: emp } : { t: "s", v: emp },
      1: { t: "s", v: u.name },
      2: { t: "s", v: u.branch ?? "" },
      3: { t: "s", v: u.jobGroup || u.position || "" },
      4: { t: "d", v: new Date(`${ymdOf(row.date)}T00:00:00`), z: "yyyy-mm-dd" },
      5: row.att?.in ? { t: "n", v: excelTime(row.att.in), z: "h:mm:ss" } : { t: "s", v: "" },
      6: row.att?.out ? { t: "n", v: excelTime(row.att.out), z: "h:mm:ss" } : { t: "s", v: "" },
      7: { t: "s", v: row.sched ? ampm(row.sched.s) : "" },
      8: { t: "s", v: row.sched ? ampm(row.sched.e) : "" },
      9: { t: "s", v: breakText },
      10: recognized != null ? { t: "n", v: recognized, z: "h:mm" } : { t: "s", v: "" },
    };
    for (const [c, cell] of Object.entries(cells)) ws[XLSX.utils.encode_cell({ r, c: Number(c) })] = cell;
    r++;
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(r - 1, 3), c: 10 } });
  ws["!cols"] = [{ wch: 10 }, { wch: 10 }, { wch: 14 }, { wch: 10 }, { wch: 12 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellDates: true }) as Buffer;

  const name = `직영점 주말근무(${yy(from)}~${yy(to)}).xlsx`;
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
    },
  });
}
