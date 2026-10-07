"use client";

import { useState } from "react";
import { toast } from "sonner";

/**
 * 여러 명 계약서 — 개인별 값 표(2026-10-07 QA #19 #34).
 * 행 = 직원, 열 = 그 양식에서 사람마다 다를 수 있는 칸(연봉·기간·근무시간 등). 비워 두면 위 공통 입력값을 쓴다.
 * 엑셀에서 여러 줄을 복사해 붙여넣을 수 있다.
 *  · 첫 줄에 열 이름(연봉·계약시작일… 또는 사번·이름)이 하나라도 있으면 그 순서로 읽는다
 *  · 열 이름이 없으면: 모든 줄의 첫 칸이 선택한 직원의 사번·이름이면 그 사람 줄에, 아니면 위에서부터 차례로(빈 줄도 한 사람)
 *  · 이름이 같은 사람이 둘 이상이면 이름으로는 넣지 않는다(사번으로)
 */
export type BulkRowValues = Record<string, Record<string, string>>; // userId → 칸 → 값

type Emp = { id: string; name: string; branch?: string | null; empNo?: number | null };

// 사람마다 따로 넣을 필요가 없는 칸 — 서버·화면이 자동으로 채우거나 계산한다
const AUTO = new Set([
  "직원명", "이름", "지점", "지점명", "사원번호", "작성일", "근로자서명", "대표서명", "원장서명", "본부서명",
  "연봉한글", "연봉총액", "월급여합계", "기본급", "연봉숫자", "식대", "생년월일", "근무시작일", "연차시작일", "원장명",
  "교육평가시작", "교육평가종료", "실무평가시작", "실무평가종료", "일근무시간", "월근로시간", "근로시작일", "이메일", "연락처",
  "입사일", "직책", "직급", "제목", "주소",
]);
const KEY_NAMES = new Set(["사번", "사원번호", "이름", "직원명", "직원", "성명"]);

/** 표에 보일 열 — 연봉(필요한 양식만) + 계약 기간 + 그 양식의 나머지 입력 칸 */
export function bulkColumns(templateFields: string[], needsSalary: boolean): string[] {
  const cols: string[] = [];
  if (needsSalary) cols.push("연봉");
  cols.push("계약시작일", "계약종료일");
  for (const f of templateFields) {
    if (AUTO.has(f) || cols.includes(f) || f.startsWith("#") || f.startsWith("/") || f.startsWith("체크_") || f.startsWith("선택_") || f.startsWith("동의")) continue;
    cols.push(f);
  }
  return cols;
}

/** 계약직 근로시간 자동 계산(작성 화면과 같은 공식). 원천 칸(출퇴근·휴게·주근무시간)이 있을 때만, 양식에 있는 칸만 */
export function deriveHours(v: Record<string, string>, templateFields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const inT = v["출근시각"] || "", outT = v["퇴근시각"] || "", rest = (v["휴게시간"] || "").trim();
  if (templateFields.includes("일근무시간") && /^\d{2}:\d{2}$/.test(inT) && /^\d{2}:\d{2}$/.test(outT) && rest) {
    const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    let mins = toMin(outT) - toMin(inT);
    if (mins < 0) mins += 1440;
    const colon = /^(\d+):(\d{1,2})$/.exec(rest);
    const hm = /([\d.]+)\s*시간/.exec(rest), mm = /([\d.]+)\s*분/.exec(rest);
    const restMin = colon ? Number(colon[1]) * 60 + Number(colon[2])
      : hm || mm ? (hm ? parseFloat(hm[1]) * 60 : 0) + (mm ? parseFloat(mm[1]) : 0)
      : parseFloat(rest.replace(/[^\d.]/g, "")) || 0;
    const work = (mins - restMin) / 60;
    out["일근무시간"] = work > 0 ? (Number.isInteger(work) ? String(work) : String(Math.round(work * 100) / 100)) : "";
  }
  const week = parseFloat(v["주근무시간"] || "");
  if (templateFields.includes("월근로시간") && week > 0) out["월근로시간"] = String(Math.round((week + (week >= 15 ? Math.min((week / 40) * 8, 8) : 0)) * 4.345));
  return out;
}

/** 교육·실무평가 단계(작성 화면과 같은 공식) — 실무평가 시작 = 기준일부터 15번째 영업일, 교육평가 종료 = 그 전날, 실무평가 종료 = +3개월−1일 */
export function evalPeriods(start: string, holidays: Set<string>): Record<string, string> | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return null;
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const isBiz = (d: Date) => { const w = d.getUTCDay(); return w !== 0 && w !== 6 && !holidays.has(fmt(d)); };
  const d = new Date(start + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  let count = 0, guard = 0;
  while (count < 15 && guard++ < 60) { if (isBiz(d)) count++; if (count < 15) d.setUTCDate(d.getUTCDate() + 1); }
  const prac = fmt(d);
  d.setUTCDate(d.getUTCDate() - 1);
  const p3 = new Date(start + "T00:00:00Z"); p3.setUTCMonth(p3.getUTCMonth() + 3); p3.setUTCDate(p3.getUTCDate() - 1);
  return { 교육평가시작: start, 교육평가종료: fmt(d), 실무평가시작: prac, 실무평가종료: fmt(p3) };
}

/** 날짜 칸 정리 — 2026-10-01 / 2026.10.01(.) / 2026/10/01 / 2026. 10. 1. / 2026년 10월 1일 / 엑셀 날짜 숫자(46296). 못 읽으면 null */
export function normDate(v: string): string | null {
  const t = v.trim();
  if (!t) return "";
  if (/^\d{5}$/.test(t)) {   // 엑셀 날짜 일련번호(1900 날짜 체계, 1899-12-30 기준)
    const n = Number(t);
    if (n < 20000 || n > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  }
  const m = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*[.일]?\s*$/.exec(t);
  if (!m) return null;
  const s = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

/** 엑셀 복사본(TSV) 읽기 — 따옴표로 감싼 칸 안의 줄바꿈·탭을 그대로 둔다 */
function parseTsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ""; let q = false;
  const s = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === "") q = true;
    else if (ch === "\t") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  // 끝에 붙은 빈 줄만 버린다 — 가운데 빈 줄은 「그 사람은 공통값」이라는 뜻이라 자리를 지킨다
  while (rows.length && rows[rows.length - 1].every((c) => !c.trim())) rows.pop();
  return rows;
}

export default function BulkValuesTable({ userIds, employees, columns, values, onChange, common }: {
  userIds: string[];
  employees: Emp[];
  columns: string[];
  values: BulkRowValues;
  onChange: (v: BulkRowValues) => void;
  common: Record<string, string>; // 비었을 때 회색으로 보여 줄 공통값
}) {
  const [paste, setPaste] = useState("");
  const emp = (id: string) => employees.find((e) => e.id === id);
  const set = (uid: string, col: string, val: string) => onChange({ ...values, [uid]: { ...(values[uid] || {}), [col]: val } });

  // 사번·이름 → 선택한 직원 한 명(이름이 겹치면 찾지 않는다)
  const whoIs = (key: string): string | null | "AMBIG" => {
    const k = key.trim();
    if (!k) return null;
    const byNo = userIds.filter((id) => { const e = emp(id); return e?.empNo != null && /^\d+$/.test(k) && Number(k) === e.empNo; });
    if (byNo.length === 1) return byNo[0];
    const byName = userIds.filter((id) => emp(id)?.name === k);
    if (byName.length > 1) return "AMBIG";
    return byName[0] ?? null;
  };

  const applyPaste = () => {
    const rows = parseTsv(paste);
    if (!rows.length) return;
    const next: BulkRowValues = { ...values };
    const problems: string[] = [];
    let used = 0;
    const put = (uid: string, cellCols: string[], cells: string[]) => {
      const row = { ...(next[uid] || {}) };
      cells.forEach((c, i) => { const col = cellCols[i]; if (col && columns.includes(col)) row[col] = c.trim(); });
      next[uid] = row; used++;
    };
    const head = rows[0].map((c) => c.trim());
    const headerMode = head.some((h) => columns.includes(h) || KEY_NAMES.has(h));
    if (headerMode) {
      const keyCol = head.findIndex((h) => KEY_NAMES.has(h));
      rows.slice(1).forEach((r, i) => {
        let uid: string | null = null;
        if (keyCol >= 0) {
          const w = whoIs(r[keyCol] || "");
          if (w === "AMBIG") { problems.push(`${r[keyCol]}: 이름이 같은 사람이 있어 사번으로 넣어 주세요`); return; }
          if (!w) { if ((r[keyCol] || "").trim()) problems.push(`${r[keyCol]}: 선택한 직원 중에 없음`); return; }
          uid = w;
        } else uid = userIds[i] ?? null;
        if (uid) put(uid, head, r);
      });
    } else {
      // 모든(빈 줄 제외) 줄의 첫 칸이 선택한 직원이면 그 사람 줄 — 하나라도 아니면 전부 차례대로(섞지 않는다)
      const keyed = rows.filter((r) => r.some((c) => c.trim())).every((r) => { const w = whoIs(r[0] || ""); return w && w !== "AMBIG"; });
      rows.forEach((r, i) => {
        if (keyed) {
          if (!r.some((c) => c.trim())) return;
          put(whoIs(r[0]) as string, columns, r.slice(1));
        } else if (userIds[i]) put(userIds[i], columns, r);
      });
      if (!keyed && rows.length > userIds.length) problems.push(`붙여넣은 ${rows.length}줄이 선택한 ${userIds.length}명보다 많습니다 — 남는 줄은 넣지 않았습니다`);
    }
    // 날짜 칸은 바로 확인 — 못 읽는 날짜는 표에 그대로 두되 알려 준다
    for (const [uid, row] of Object.entries(next)) {
      for (const k of ["계약시작일", "계약종료일"]) if (row[k] && normDate(row[k]) === null) problems.push(`${emp(uid)?.name}: ${k} 「${row[k]}」을(를) 날짜로 읽지 못했습니다`);
    }
    onChange(next);
    if (problems.length) toast.warning(`${used}명 넣음 — 확인할 것: ${problems.slice(0, 5).join(" / ")}${problems.length > 5 ? ` 외 ${problems.length - 5}건` : ""}`, { duration: 15000 });
    else toast.success(`${used}명 값을 넣었습니다. 표에서 확인해 주세요.`);
    setPaste("");
  };

  if (!userIds.length || !columns.length) return null;
  return (
    <div className="space-y-2 border border-blue-200 rounded-lg p-3 bg-blue-50/40">
      <p className="text-xs font-semibold text-blue-800">개인별 값 — 비워 두면 위 공통 입력값이 들어갑니다</p>
      <div className="overflow-x-auto max-h-72 overflow-y-auto rounded border bg-white">
        <table className="text-xs w-full">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">직원</th>
              {columns.map((c) => <th key={c} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {userIds.map((uid) => {
              const e = emp(uid);
              return (
                <tr key={uid} className="border-t">
                  <td className="px-2 py-1 whitespace-nowrap">{e?.name}{e?.empNo != null ? <span className="text-gray-400"> {String(e.empNo).padStart(5, "0")}</span> : null}{e?.branch ? <span className="text-gray-400"> · {e.branch}</span> : null}</td>
                  {columns.map((c) => {
                    const v = values[uid]?.[c] ?? "";
                    const bad = (c === "계약시작일" || c === "계약종료일") && v && normDate(v) === null;
                    return (
                      <td key={c} className="px-1 py-0.5">
                        <input value={v} placeholder={common[c] ?? ""}
                          onChange={(ev) => set(uid, c, ev.target.value)}
                          className={`w-28 rounded border px-1.5 py-1 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-300 ${bad ? "border-red-400 bg-red-50" : "border-gray-200"}`} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex gap-2 items-start">
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={2}
          placeholder={`엑셀에서 여러 줄을 복사해 붙여넣기 — 첫 줄에 열 이름(사번·${columns.slice(0, 3).join("·")}…)을 넣으면 그 순서로`}
          className="flex-1 rounded border px-2 py-1 text-xs resize-none" />
        <button type="button" onClick={applyPaste} disabled={!paste.trim()}
          className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-xs text-white disabled:bg-gray-300">표에 넣기</button>
      </div>
    </div>
  );
}
