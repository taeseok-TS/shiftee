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
  const v = row ? Number(row.value.replace(/[^0-9.]/g, "")) : NaN;   // "10,320" 처럼 쉼표를 넣어도
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
    // 월 소정 시간은 100~260 사이만 — 「월 40시간 이내」 같은 다른 숫자를 먼저 잡지 않게(검증 F4)
    const pick = (re: RegExp) => [...text.matchAll(re)].map((m) => Number(m[1])).find((n) => n >= 100 && n <= 260) ?? null;
    const hours = pick(/약\s*(\d{2,3})\s*H/gi) ?? pick(/(\d{3})\s*H\b/g) ?? pick(/월[^\d\n]{0,8}(\d{3})\s*시간/g) ?? pick(/약\s*(\d{3})\s*시간/g);
    hoursCache.set(file, { mtimeMs: st.mtimeMs, hours });
    return hours;
  } catch {
    return null;
  }
}

// 첫 번째 숫자만 읽는다(쉼표 허용) — 「8시간(휴게 1시간 제외)」→8, 「1,210,000원」→1210000. 종전처럼 숫자를 다 이어 붙이면
// 「1일 8시간」→18, 「4~8」→48 로 읽혀 멀쩡한 계약을 막았다(검증 F7)
const num = (v: string | undefined | null): number | null => {
  const m = /\d[\d,]*(?:\.\d+)?/.exec(v || "");
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
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
  const mwLabel = `${mw.year}년 최저임금 ${won(mw.won)}${mw.year !== year ? ` — ${year}년 금액이 아직 등록되지 않아 ${mw.year}년 금액으로 봤습니다` : ""}`;
  if (has("월급여액")) {
    const pay = num(merge["월급여액"]);
    // 월 근로시간 — 입력값과 주 근무시간으로 계산한 값((주+주휴)×4.345) 중 큰 쪽. 비우거나 손으로 낮춰 검사를 피하지 못하게(검증 F2)
    const entered = num(merge["월근로시간"]);
    const computed = week != null && week > 0 ? Math.round((week + Math.min((week / 40) * 8, 8)) * 4.345) : null;
    const hours = Math.max(entered ?? 0, computed ?? 0) || null;
    if (!pay) errors.push("월 급여액을 입력해 주세요.");
    else if (!hours) errors.push("주 근무시간(또는 월 근로시간)을 입력해 주세요 — 최저임금을 확인할 수 없습니다.");
    else if (pay / hours < mw.won) {
      errors.push(`최저임금 미만입니다 — 월 급여 ${won(pay)} ÷ 월 ${hours}시간 = 시급 ${won(pay / hours)} (${mwLabel}). 금액을 고쳐야 저장·발송할 수 있습니다.`);
    }
  } else if (has("기본급") || has("연봉") || has("연봉숫자")) {
    const base = num(merge["기본급"]);
    const monthly = num(merge["월급여합계"]) ?? (base != null ? base + (num(merge["식대"]) ?? 0) : null);
    let hours = await templateMonthlyHours(opts.templateFileUrl);
    if (!hours) {
      // 문서 문구가 바뀌어 월 시간을 못 찾으면 주 40시간 기준(209시간)으로 본다 — 검사가 통째로 빠지지 않게(검증 F4)
      console.warn("[contract-validate] 양식에서 월 소정시간을 찾지 못해 209시간으로 검사:", opts.templateFileUrl);
      hours = 209;
    }
    if (!monthly) errors.push("연봉을 입력해 주세요.");
    else if (monthly / hours < mw.won) {
      errors.push(`최저임금 미만입니다 — 월 급여(기본급+식대) ${won(monthly)} ÷ 월 ${hours}시간 = 시급 ${won(monthly / hours)} (${mwLabel}). 연봉을 고쳐야 저장·발송할 수 있습니다.`);
    } else if (has("실무지급률")) {
      // 실무평가(수습) 단계는 월 급여의 N%(기본 85) — 수습 감액은 최저임금의 90%까지만 된다(최저임금법 제5조 2항, 검증 F6)
      const rate = num(merge["실무지급률"]) ?? 85;
      const prob = (monthly * rate) / 100;
      if (prob / hours < mw.won * 0.9) {
        errors.push(`실무평가(수습) 단계 급여가 최저임금의 90% 미만입니다 — 월 급여의 ${rate}% ${won(prob)} ÷ 월 ${hours}시간 = 시급 ${won(prob / hours)} (하한 ${won(mw.won * 0.9)}, ${mwLabel}). 연봉이나 지급률을 고쳐야 저장·발송할 수 있습니다.`);
      }
    }
  }
  return errors;
}

/** 저장된(또는 이번 요청으로 바뀔) 계약을 발송하기 전에 검사. 금액·시간은 템플릿(.docx)이 있는 계약만,
 *  기간 역순은 파일을 직접 올린 계약도 본다(검증 F3) */
export async function validateStoredContract(c: {
  userId: string; templateId: string | null; title: string; startDate: Date | null; endDate: Date | null;
  extraFields: unknown; externalName: string | null; externalPhone: string | null;
}): Promise<string[]> {
  const sd = c.startDate ? c.startDate.toISOString().slice(0, 10) : "", edd = c.endDate ? c.endDate.toISOString().slice(0, 10) : "";
  const dateErr = sd && edd && sd > edd ? [`계약 종료일(${edd})이 시작일(${sd})보다 빠릅니다.`] : [];
  if (!c.templateId) return dateErr;
  const tmpl = await prisma.contractTemplate.findUnique({ where: { id: c.templateId }, select: { fileUrl: true } });
  if (!tmpl?.fileUrl.toLowerCase().endsWith(".docx")) return dateErr;
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
