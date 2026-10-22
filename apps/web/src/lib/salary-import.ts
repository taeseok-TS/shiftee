// 연봉이력(RAW) 엑셀 읽기(2026-10-22 디렉터) — 본부 박정인 시트 「연봉이력(RAW)」 그대로.
// 열: 사번 · 직무(매니저/코디/학습실장) · 이름 · 연봉적용기간 (시작) · 연봉적용기간 (끝) · 계약 연봉 · 갱신여부
// 머리 줄은 「사번」이 있는 줄로 찾는다(위에 제목 줄이 있어도 된다). 탭이 여럿이면 「연봉이력」이 든 탭, 없으면 첫 탭.
// 날짜 칸은 셀 값(엑셀 날짜 일련번호)을 직접 날짜로 바꾼다 — cellDates 로 읽으면 KST 에서 하루 밀린다(xlsx 날짜 셀 함정).
import * as XLSX from "xlsx";

export type SalaryRow = { line: number; empNo: number; name: string; jobTitle: string | null; startDate: string; endDate: string | null; amount: number; renewed: boolean };
export type SalaryParse = { rows: SalaryRow[]; errors: { line: number; message: string }[]; sheet: string };

const norm = (v: unknown) => String(v ?? "").replace(/\s+/g, "").trim();
const pad = (n: number) => String(n).padStart(2, "0");

/** 엑셀 일련번호·「2024-01-01」·「2024. 1. 1.」·「2024/1/1」 → "YYYY-MM-DD" */
export function toYmd(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    if (v < 20000 || v > 80000) return null;   // 1954~2119 밖이면 날짜가 아니다
    const d = new Date(Math.round((v - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  const m = String(v).trim().match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

export function parseSalaryFile(buf: Buffer): SalaryParse {
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.SheetNames.find((n) => n.includes("연봉이력")) ?? wb.SheetNames[0];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheet], { header: 1, raw: true, defval: "" });
  const head = grid.findIndex((r) => r.some((c) => norm(c) === "사번"));
  if (head < 0) return { rows: [], errors: [{ line: 0, message: "「사번」 머리 줄을 찾지 못했습니다. 연봉이력(RAW) 시트를 올려 주세요." }], sheet };
  const H = grid[head].map(norm);
  // 이름 순서대로 먼저 맞는 열 — 「연봉」은 「연봉적용기간」에도 들어 있어 「계약연봉」을 먼저 찾는다
  const col = (...names: string[]) => { for (const n of names) { const i = H.findIndex((h) => h.includes(n)); if (i >= 0) return i; } return -1; };
  const c = {
    emp: col("사번"), job: col("매니저/코디", "직무"), name: col("이름"),
    start: col("(시작)", "시작일"), end: col("(끝)", "종료일"), amount: col("계약연봉", "연봉액"), renew: col("갱신"),
  };
  const missing = Object.entries({ 사번: c.emp, 이름: c.name, "연봉적용기간 (시작)": c.start, "계약 연봉": c.amount }).filter(([, i]) => i < 0).map(([k]) => k);
  if (missing.length) return { rows: [], errors: [{ line: head + 1, message: `열이 없습니다: ${missing.join(", ")}` }], sheet };
  const rows: SalaryRow[] = [], errors: { line: number; message: string }[] = [];
  for (let i = head + 1; i < grid.length; i++) {
    const r = grid[i];
    const line = i + 1;
    if (!r || r.every((v) => norm(v) === "")) continue;
    const empDigits = norm(r[c.emp]).replace(/\D/g, "");
    const name = String(r[c.name] ?? "").trim();
    const startDate = toYmd(r[c.start]);
    // 금액 — 숫자 셀은 반올림, 글자 셀은 ₩·쉼표·원·띄어쓰기만 지운다(소수점까지 지우면 30000000.6 → 300,000,006 이 됐다, 검증)
    const rawAmt = r[c.amount];
    const amount = typeof rawAmt === "number" ? Math.round(rawAmt) : Math.round(Number(String(rawAmt ?? "").replace(/[₩,원\s]/g, "")));
    if (!empDigits) { errors.push({ line, message: "사번이 없습니다" }); continue; }
    if (Number(empDigits) > 9_999_999) { errors.push({ line, message: "사번이 너무 깁니다(7자리 이하)" }); continue; }
    if (!name) { errors.push({ line, message: "이름이 없습니다" }); continue; }
    if (!startDate) { errors.push({ line, message: "연봉적용기간(시작) 날짜를 읽지 못했습니다" }); continue; }
    if (!Number.isFinite(amount) || amount < 1_000_000 || amount > 1_000_000_000) { errors.push({ line, message: "계약 연봉이 숫자가 아니거나 범위를 벗어났습니다" }); continue; }
    const endRaw = c.end >= 0 ? r[c.end] : "";
    // 끝 날짜 — 「-」·「재직중」처럼 숫자가 없는 글자는 「끝 없음」. 숫자가 있는데 날짜가 아니면 오류
    const endDate = norm(endRaw) ? toYmd(endRaw) : null;
    if (norm(endRaw) && !endDate && /\d/.test(String(endRaw))) { errors.push({ line, message: "연봉적용기간(끝) 날짜를 읽지 못했습니다" }); continue; }
    rows.push({
      line, empNo: Number(empDigits), name, jobTitle: c.job >= 0 ? String(r[c.job] ?? "").trim() || null : null,
      // 「갱신」만 갱신 — 「미갱신」·「갱신안함」은 아니다
      startDate, endDate, amount, renewed: c.renew >= 0 && /^갱신(됨|완료)?$/.test(norm(r[c.renew])),
    });
  }
  // 파일 안 같은 사번·같은 시작일 — 뒤 줄을 쓴다(앞 줄은 오류로 알림)
  const seen = new Map<string, number>();
  rows.forEach((r, idx) => {
    const k = `${r.empNo}|${r.startDate}`;
    const prev = seen.get(k);
    if (prev !== undefined) errors.push({ line: rows[prev].line, message: `같은 사번·시작일이 ${r.line}행에도 있어 ${r.line}행 값을 씁니다` });
    seen.set(k, idx);
  });
  const keep = new Set(seen.values());
  return { rows: rows.filter((_, i) => keep.has(i)), errors, sheet };
}
