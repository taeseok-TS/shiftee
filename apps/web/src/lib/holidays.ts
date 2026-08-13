import { prisma } from "@/lib/db";

// 공휴일 판정 유틸 — Holiday 테이블이 유일한 진실 소스.
// @db.Date 컬럼은 UTC 자정으로 저장되므로 Date 객체 직접 비교 금지,
// 저장·비교 모두 "YYYY-MM-DD" 문자열로 정규화한다 (타임존 하루 밀림 방지).

/** Date → "YYYY-MM-DD" (UTC 기준 — @db.Date 저장 규칙과 동일) */
export function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** 오늘 날짜(KST) → "YYYY-MM-DD" (서버 TZ는 UTC) */
export function kstTodayYmd(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** 기간 내 공휴일 셋 (키: "YYYY-MM-DD") */
export async function getHolidaySet(start: Date, end: Date): Promise<Set<string>> {
  const rows = await prisma.holiday.findMany({
    where: { date: { gte: start, lte: end } },
    select: { date: true },
  });
  return new Set(rows.map((r) => ymdUTC(r.date)));
}

/** 단일 날짜("YYYY-MM-DD")가 공휴일인지 */
export async function isHoliday(ymd: string): Promise<boolean> {
  const row = await prisma.holiday.findUnique({
    where: { date: new Date(ymd) }, // "YYYY-MM-DD" 파싱은 UTC 자정 — 저장 규칙과 일치
    select: { id: true },
  });
  return !!row;
}
