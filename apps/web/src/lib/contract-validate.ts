import path from "path";
import fs from "fs/promises";
import PizZip from "pizzip";
import { prisma } from "@/lib/db";
import { buildContractMergeData, templateFieldNames, isFillableTemplate } from "@/lib/contract-fields";
import { hoursNum, dayTableWeekHours, normalizeWeekday } from "@/lib/contract-field-settings";

// ─── 전자계약 값 검증(2026-10-07 QA #24, 본부 답변 #32 「최저임금 미만이면 발송을 막아 주세요(경고 아님)」) ───
// 작성·수정·발송 때 서버가 본다. 하나라도 걸리면 저장·발송하지 않고 이유를 돌려준다.
//  · 최저임금: 계약직 양식은 {월급여액} ÷ {월근로시간}, 연봉 양식은 월 급여합계(기본급+식대) ÷ 문서에 적힌 월 시간
//    (「약 209 H」·「월 209시간」). 식대는 넣는다 — 2024년부터 매월 주는 복리후생비는 최저임금에 전부 들어간다(최저임금법).
//    본부가 기본급만으로 보길 원하면 여기 한 곳만 바꾸면 된다.
//  · 소정근로시간: 주 40시간·하루 8시간 이하(근로기준법 제50조)
//  · 계약 기간: 시작일 ≤ 종료일
//  · 신규입사 평가 기간(2026-10-16 이예지 QA): 근로시작일·교육/실무평가 시작·종료가 양식에 있으면 빈칸 금지,
//    시작 ≤ 종료, 교육평가가 실무평가보다 먼저, 계약 기간 안. 재계약은 평가 구간이 문서에서 빠지므로 보지 않는다
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
// 시간 칸 읽기(hoursNum)는 lib/contract-field-settings 로 옮겼다 — 파생 칸 {주휴수당표기}(요일 표 합계)와 같은 규칙으로 읽게(10/23)
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

  // 신규입사 평가 기간
  if (merge["재계약"] !== "1" && ["교육평가시작", "교육평가종료", "실무평가시작", "실무평가종료"].some(has)) {
    const iso = (v: string | undefined) => {
      const t = (v || "").trim();
      const m = /^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일$/.exec(t) || /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
      return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
    };
    const label: Record<string, string> = { 근로시작일: "근로시작일", 교육평가시작: "교육평가 시작일", 교육평가종료: "교육평가 종료일", 실무평가시작: "실무평가 시작일", 실무평가종료: "실무평가 종료일" };
    const d: Record<string, string | null> = {};
    const missing: string[] = [];
    for (const k of ["근로시작일", "교육평가시작", "교육평가종료", "실무평가시작", "실무평가종료"]) {
      if (!has(k)) continue;
      d[k] = iso(merge[k]);
      if (!(merge[k] || "").trim()) missing.push(label[k]);
      else if (!d[k]) errors.push(`${label[k]}「${merge[k]}」을(를) 날짜로 읽지 못했습니다.`);
    }
    if (missing.length) errors.push(`${missing.join("·")}을(를) 입력해 주세요 — 신규입사 계약서에 꼭 들어가는 칸입니다.`);
    const pair = (a: string, b: string, msg: string) => { if (d[a] && d[b] && d[a]! > d[b]!) errors.push(msg.replace("{a}", d[a]!).replace("{b}", d[b]!)); };
    pair("교육평가시작", "교육평가종료", "교육평가 종료일({b})이 시작일({a})보다 빠릅니다.");
    pair("실무평가시작", "실무평가종료", "실무평가 종료일({b})이 시작일({a})보다 빠릅니다.");
    if (d["교육평가종료"] && d["실무평가시작"] && d["교육평가종료"]! >= d["실무평가시작"]!)
      errors.push(`교육평가 종료일(${d["교육평가종료"]})은 실무평가 시작일(${d["실무평가시작"]}) 전이어야 합니다.`);
    // 계약 기간 밖 — 시작은 계약 시작일 이전, 끝은 계약 종료일 이후면 막는다(기간 없는 계약은 끝을 보지 않는다)
    for (const k of ["교육평가시작", "교육평가종료", "실무평가시작", "실무평가종료"]) {
      const v = d[k];
      if (!v) continue;
      if (sd && v < sd) { errors.push(`${label[k]}(${v})이 계약 시작일(${sd})보다 앞입니다 — 평가 기간은 계약 기간 안이어야 합니다.`); break; }
      if (ed && v > ed) { errors.push(`${label[k]}(${v})이 계약 종료일(${ed})보다 뒤입니다 — 평가 기간은 계약 기간 안이어야 합니다.`); break; }
    }
  }

  // 소정근로시간
  const week = hoursNum(merge["주근무시간"]);
  if (has("주근무시간") && week != null && week > 40) errors.push(`주 근무시간 ${week}시간 — 소정근로시간은 주 40시간을 넘을 수 없습니다.`);
  const day = hoursNum(merge["일근무시간"]);
  if (has("일근무시간") && day != null && day > 8) errors.push(`하루 근무시간 ${day}시간 — 소정근로시간은 하루 8시간을 넘을 수 없습니다.`);

  // 근무 시각 칸은 비운 채 보내지 못한다(2026-10-28 이예지 — 계약직 코디는 사람마다 시각이 달라 기본값 없이 그때그때 넣는다)
  {
    const timeKeys: [string, string, string[]][] = [
      ["출근시각", "출근 시각", ["출근시각", "출근시각12"]], ["퇴근시각", "퇴근 시각", ["퇴근시각", "퇴근시각12"]], ["휴게시간", "휴게 시간", ["휴게시간"]],
    ];
    const empty = timeKeys.filter(([k, , ph]) => ph.some(has) && !(merge[k] || "").trim()).map(([, label]) => label);
    if (empty.length) errors.push(`${empty.join(" · ")}을(를) 넣어 주세요 — 비워 둔 채로는 보낼 수 없습니다.`);
  }
  // 코디 오전판(양식 이름에 「오전」, 문장은 「{출근시각} ～ {퇴근시각}」) — 출근이 12:00 이후면 오후 근무라 오후판으로(퇴근은 오후일 수 있어 출근만 본다)
  if (has("출근시각") && !has("출근시각12")) {
    const tname = (await prisma.contractTemplate.findFirst({ where: { fileUrl: opts.templateFileUrl }, select: { name: true } }).catch(() => null))?.name ?? "";
    const v = (merge["출근시각"] || "").trim();
    const m = v.match(/^(\d{1,2}):(\d{2})$/);
    if (tname.includes("오전") && v && (!m || Number(m[2]) > 59)) errors.push(`출근 시각「${v}」을(를) 시각(예: 09:00)으로 읽지 못했습니다.`);
    else if (tname.includes("오전") && m && Number(m[1]) >= 12)
      errors.push(`출근 시각 ${v} — 오전 근무 계약서입니다. 12:00 전 시각을 넣어 주세요(오후 근무는 오후판 양식으로).`);
  }

  // 코디 오후판(문장이 「오후 {출근시각12} ～ 오후 {퇴근시각12}」) — 오전 시각을 넣으면 「오후 9:00」처럼 틀린 문서가 된다
  if (has("출근시각12") || has("퇴근시각12")) {
    for (const [k, label] of [["출근시각", "출근 시각"], ["퇴근시각", "퇴근 시각"]] as const) {
      const v = (merge[k] || "").trim();
      const m = v.match(/^(\d{1,2}):(\d{2})$/);
      if (!v) continue;
      if (!m || Number(m[2]) > 59) errors.push(`${label}「${v}」을(를) 시각(예: 14:00)으로 읽지 못했습니다.`);
      else if (Number(m[1]) < 12 || Number(m[1]) > 23) errors.push(`${label} ${v} — 오후 근무 계약서입니다. 12:00~23:59 사이 시각을 넣어 주세요(오전 근무는 오전판 양식으로).`);
    }
  }

  // 주휴일(주말 학습실장 제5조 「주휴일({주휴일지정})」, 2026-10-23 본부) — 월~일 중 하나이고, 요일 표에서 근무가 없는 날이어야 한다.
  // 값은 lib/contract-fields 가 「월」·「월요일」을 「월요일」로 맞춰 두고, 비우면 「월요일」이 들어간다
  if (has("주휴일지정")) {
    const raw = (merge["주휴일지정"] || "").trim();
    const day = normalizeWeekday(raw);
    if (!day) errors.push(`주휴일「${raw}」을(를) 요일로 읽지 못했습니다 — 월요일~일요일 중 하나(「월요일」 또는 「월」)로 넣어 주세요.`);
    else if ((hoursNum(merge[`${day}근로시간`]) ?? 0) > 0)
      errors.push(`주휴일은 근무하지 않는 날이어야 합니다 — ${day}은 요일 표에 근무가 있습니다. 주휴일 칸에 근무가 없는 요일을 넣어 주세요(비우면 월요일).`);
  }

  // 최저임금
  const year = Number(sd.slice(0, 4)) || new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
  const mw = await minWageFor(year);
  const mwLabel = `${mw.year}년 최저임금 ${won(mw.won)}${mw.year !== year ? ` — ${year}년 금액이 아직 등록되지 않아 ${mw.year}년 금액으로 봤습니다` : ""}`;
  if (has("월급여액")) {
    const pay = num(merge["월급여액"]);
    // 월 근로시간 — 입력값과 주 근무시간으로 계산한 값((주+주휴)×4.345) 중 큰 쪽. 비우거나 손으로 낮춰 검사를 피하지 못하게(검증 F2)
    const entered = hoursNum(merge["월근로시간"]);
    // 주휴는 주 15시간 이상만(근로기준법 제18조 3항) — 15시간 미만에 주휴를 넣으면 합법 금액이 막힌다(재검증 F2)
    const computed = week != null && week > 0 ? Math.round((week + (week >= 15 ? Math.min((week / 40) * 8, 8) : 0)) * 4.345) : null;
    const hours = Math.max(entered ?? 0, computed ?? 0) || null;
    if (!pay) errors.push("월 급여액을 입력해 주세요.");
    else if (!hours) errors.push("주 근무시간(또는 월 근로시간)을 입력해 주세요 — 최저임금을 확인할 수 없습니다.");
    else if (pay / hours < mw.won) {
      errors.push(`최저임금 미만입니다 — 월 급여 ${won(pay)} ÷ 월 ${hours}시간 = 시급 ${won(pay / hours)} (${mwLabel}). 금액을 고쳐야 저장·발송할 수 있습니다.`);
    }
  } else if (has("주말급여합계")) {
    // 주말 학습실장(2026-10-23) — 월 급여 = 기본급 + 주말수당 + 주휴수당(파생 {주말급여합계}) ÷ {월근로시간}, 그리고 적힌 {통상시급}
    const pay = num(merge["주말급여합계"]);
    // 월 근로시간 — 입력값과 요일 표(월~일 근로시간)로 계산한 값((주+주휴)×4.345) 중 큰 쪽. 손으로 낮춰 검사를 피하지 못하게({월급여액} 분기와 같은 방어)
    // 주 15시간 미만은 주휴가 없다 — 시간에 주휴를 넣지 않고, 금액({주말급여합계})도 주휴수당을 0 으로 더한 값이다(lib/contract-fields, 10/23 본부)
    const wk = dayTableWeekHours(merge);
    const computedW = wk > 0 ? Math.round((wk + (wk >= 15 ? Math.min((wk / 40) * 8, 8) : 0)) * 4.345) : null;
    const hours = Math.max(hoursNum(merge["월근로시간"]) ?? 0, computedW ?? 0) || null;
    const hourly = num(merge["통상시급"]);
    if (!pay) errors.push("기본급 · 주말수당 · 주휴수당 금액을 입력해 주세요.");
    else if (!hours) errors.push("월 근로시간을 입력해 주세요 — 최저임금을 확인할 수 없습니다.");
    else if (pay / hours < mw.won) {
      errors.push(`최저임금 미만입니다 — 월 급여 ${won(pay)} ÷ 월 ${hours}시간 = 시급 ${won(pay / hours)} (${mwLabel}). 금액을 고쳐야 저장·발송할 수 있습니다.`);
    }
    if (hourly != null && hourly < mw.won) errors.push(`통상시급 ${won(hourly)}이 최저임금보다 낮습니다 (${mwLabel}).`);
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
    } else if (has("실무지급률") && merge["재계약"] !== "1") {
      // 실무평가(수습) 단계는 월 급여의 N%(기본 85). 수습 조항은 신규입사 구간({#신규입사})에만 있다 — 재계약은 보지 않는다(재검증 N1).
      // 수습 감액은 1년 이상 계약(기간 없는 계약 포함)에서만 최저임금의 90%까지 된다(최저임금법 제5조 2항) — 1년 미만이면 100%
      const rate = num(merge["실무지급률"]) ?? 85;
      const prob = (monthly * rate) / 100;
      // 1년 = 시작일의 1년 뒤 같은 날 − 1일까지(윤년도 정확히, 재검증 N3)
      // 시작일이 없거나 날짜가 이상하면 1년 이상으로 본다 — 계산이 던져 500 이 나지 않게(재검증 N4)
      const yearEnd = (from: string): string | null => {
        const d = new Date(`${from}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) return null;
        d.setUTCFullYear(d.getUTCFullYear() + 1); d.setUTCDate(d.getUTCDate() - 1);
        return d.toISOString().slice(0, 10);
      };
      const ye = sd ? yearEnd(sd) : null;
      const oneYear = !opts.endDate || !ye || opts.endDate.slice(0, 10) >= ye;
      const floor = mw.won * (oneYear ? 0.9 : 1);
      if (prob / hours < floor) {
        errors.push(`실무평가(수습) 단계 급여가 ${oneYear ? "최저임금의 90%" : "최저임금(1년 미만 계약은 수습 감액 불가)"} 미만입니다 — 월 급여의 ${rate}% ${won(prob)} ÷ 월 ${hours}시간 = 시급 ${won(prob / hours)} (하한 ${won(floor)}, ${mwLabel}). 연봉이나 지급률을 고쳐야 저장·발송할 수 있습니다.`);
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
  // 잘못된 날짜(Invalid Date)는 없는 것으로 — toISOString 이 던지지 않게
  const iso = (d: Date | null) => (d && !Number.isNaN(d.getTime()) ? d.toISOString() : null);
  const sd = iso(c.startDate)?.slice(0, 10) ?? "", edd = iso(c.endDate)?.slice(0, 10) ?? "";
  const dateErr = sd && edd && sd > edd ? [`계약 종료일(${edd})이 시작일(${sd})보다 빠릅니다.`] : [];
  if (!c.templateId) return dateErr;
  const tmpl = await prisma.contractTemplate.findUnique({ where: { id: c.templateId }, select: { fileUrl: true } });
  if (!isFillableTemplate(tmpl?.fileUrl)) return dateErr;
  const extra = (c.extraFields as Record<string, string>) || {};
  const startDate = iso(c.startDate);
  const endDate = iso(c.endDate);
  const merge = await buildContractMergeData(c.userId, { templateId: c.templateId,
    title: c.title, startDate, endDate,
    salary: ((extra["연봉"] || "").replace(/[^0-9]/g, "")) || null,
    extraFields: extra,
    external: c.externalName ? { name: c.externalName, phone: c.externalPhone } : null,
  });
  return validateContractMerge(merge, { templateFileUrl: tmpl.fileUrl, startDate, endDate });
}
