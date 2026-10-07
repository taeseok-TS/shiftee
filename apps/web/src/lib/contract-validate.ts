import path from "path";
import fs from "fs/promises";
import PizZip from "pizzip";
import { prisma } from "@/lib/db";
import { buildContractMergeData, templateFieldNames } from "@/lib/contract-fields";

// ─── 전자계약 값 검증(2026-10-07 QA #24, 본부 답변 #32 「최저임금 미만이면 발송을 막아 주세요(경고 아님)」) ───
// 작성·수정·발송 때 서버가 본다. 하나라도 걸리면 저장·발송하지 않고 이유를 돌려준다.
//  · 최저임금: 계약직 양식은 {월급여액} ÷ {월근로시간}, 연봉 양식은 월 급여합계(기본급+식대) ÷ 문서에 적힌 월 시간
//    (「약 209 H」·「월 209시간」). 식대는 넣는다 — 2024년부터 매월 주는 복리후생비는 최저임금에 전부 들어간다(최저임금법).
//    본부가 기본급만으로 보길 원하면 여기 한 곳만 바꾸면 된다.
//  · 소정근로시간: 주 40시간·하루 8시간 이하(근로기준법 제50조)
//  · 계약 기간: 시작일 ≤ 종료일
// 최저임금(시급)은 연도별 — 계약 시작일의 해. 새 해 금액은 AppSetting `minWage:YYYY` 로 넣으면 코드 수정 없이 반영된다.
const MIN_WAGE: Record<number, number> = { 2024: 9860, 2025: 10030, 2026: 10320 };

export async function minWageFor(year: number): Promise<{ year: number; won: number }> {
  const row = await prisma.appSetting.findUnique({ where: { key: `minWage:${year}` } }).catch(() => null);
  const v = row ? Number(row.value) : NaN;
  if (Number.isFinite(v) && v > 0) return { year, won: v };
  if (MIN_WAGE[year]) return { year, won: MIN_WAGE[year] };
  // 표에 없는 해 — 알려진 가장 가까운 해(미래면 최신값)로 본다
  const known = Object.keys(MIN_WAGE).map(Number).sort((a, b) => a - b);
  const y = year > known[known.length - 1] ? known[known.length - 1] : known[0];
  return { year: y, won: MIN_WAGE[y] };
}

const hoursCache = new Map<string, { mtimeMs: number; hours: number | null }>();
/** 연봉 양식 문서에 적힌 월 소정 시간(주휴 포함) — 「약 209 H」 또는 「월 209시간」 */
export async function templateMonthlyHours(templateFileUrl: string): Promise<number | null> {
  if (!templateFileUrl.toLowerCase().endsWith(".docx")) return null;
  try {
    const file = path.join(process.cwd(), "uploads", templateFileUrl.replace(/^\/api\/uploads\//, ""));
    const st = await fs.stat(file);
    const hit = hoursCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.hours;
    const xml = new PizZip(await fs.readFile(file)).file("word/document.xml")?.asText() || "";
    const text = (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
      .map((p) => (p.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, "")).join(""))
      .join("\n");
    const m = /약\s*(\d{2,3})\s*H/i.exec(text) || /월\s*(\d{2,3})\s*시간/.exec(text);
    const hours = m ? Number(m[1]) : null;
    hoursCache.set(file, { mtimeMs: st.mtimeMs, hours });
    return hours;
  } catch {
    return null;
  }
}

const num = (v: string | undefined | null): number | null => {
  const d = (v || "").replace(/[^0-9.]/g, "");
  return d ? Number(d) : null;
};
const won = (n: number) => `${Math.floor(n).toLocaleString()}원`;

/** 치환값(mergeData)으로 검사 — 문제 목록(비면 통과) */
export async function validateContractMerge(
  merge: Record<string, string>,
  opts: { templateFileUrl: string; startDate: string | null; endDate: string | null },
): Promise<string[]> {
  const errors: string[] = [];
  const names = (await templateFieldNames(opts.templateFileUrl)) || [];
  const has = (k: string) => names.includes(k);

  const sd = opts.startDate ? opts.startDate.slice(0, 10) : "";
  const ed = opts.endDate ? opts.endDate.slice(0, 10) : "";
  if (sd && ed && sd > ed) errors.push(`계약 종료일(${ed})이 시작일(${sd})보다 빠릅니다.`);

  // 소정근로시간
  const week = num(merge["주근무시간"]);
  if (has("주근무시간") && week != null && week > 40) errors.push(`주 근무시간 ${week}시간 — 소정근로시간은 주 40시간을 넘을 수 없습니다.`);
  const day = num(merge["일근무시간"]);
  if (has("일근무시간") && day != null && day > 8) errors.push(`하루 근무시간 ${day}시간 — 소정근로시간은 하루 8시간을 넘을 수 없습니다.`);

  // 최저임금
  const year = Number(sd.slice(0, 4)) || new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
  const mw = await minWageFor(year);
  if (has("월급여액")) {
    const pay = num(merge["월급여액"]);
    const hours = num(merge["월근로시간"]);
    if (!pay) errors.push("월 급여액을 입력해 주세요.");
    else if (hours && hours > 0 && pay / hours < mw.won) {
      errors.push(`최저임금 미만입니다 — 월 급여 ${won(pay)} ÷ 월 ${hours}시간 = 시급 ${won(pay / hours)} (${year}년 최저임금 ${won(mw.won)}). 금액을 고쳐야 저장·발송할 수 있습니다.`);
    }
  } else if (has("기본급") || has("연봉") || has("연봉숫자")) {
    const base = num(merge["기본급"]);
    const monthly = num(merge["월급여합계"]) ?? (base != null ? base + (num(merge["식대"]) ?? 0) : null);
    const hours = await templateMonthlyHours(opts.templateFileUrl);
    if (!monthly) errors.push("연봉을 입력해 주세요.");
    else if (hours && monthly / hours < mw.won) {
      errors.push(`최저임금 미만입니다 — 월 급여(기본급+식대) ${won(monthly)} ÷ 월 ${hours}시간 = 시급 ${won(monthly / hours)} (${year}년 최저임금 ${won(mw.won)}). 연봉을 고쳐야 저장·발송할 수 있습니다.`);
    }
  }
  return errors;
}

/** 저장된 계약을 발송하기 전에 검사 — 템플릿(.docx)이 있는 계약만. 템플릿 없는 계약(파일 직접 올림)은 검사하지 않는다 */
export async function validateStoredContract(c: {
  userId: string; templateId: string | null; title: string; startDate: Date | null; endDate: Date | null;
  extraFields: unknown; externalName: string | null; externalPhone: string | null;
}): Promise<string[]> {
  if (!c.templateId) return [];
  const tmpl = await prisma.contractTemplate.findUnique({ where: { id: c.templateId }, select: { fileUrl: true } });
  if (!tmpl?.fileUrl.toLowerCase().endsWith(".docx")) return [];
  const extra = (c.extraFields as Record<string, string>) || {};
  const startDate = c.startDate ? c.startDate.toISOString() : null;
  const endDate = c.endDate ? c.endDate.toISOString() : null;
  const merge = await buildContractMergeData(c.userId, {
    title: c.title, startDate, endDate,
    salary: ((extra["연봉"] || "").replace(/[^0-9]/g, "")) || null,
    extraFields: extra,
    external: c.externalName ? { name: c.externalName, phone: c.externalPhone } : null,
  });
  return validateContractMerge(merge, { templateFileUrl: tmpl.fileUrl, startDate, endDate });
}
