"use client";

import { useState } from "react";
import { evalPeriodsFor, type Cohort } from "@/lib/route-course";
import { toast } from "sonner";
import { koreanMoney } from "@/lib/korean-money";
import { DERIVED_FIELD_SOURCES } from "@/lib/contract-field-settings";

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
  "일근무시간", "월근로시간", "이메일", "연락처",
  "입사일", "직책", "직급", "제목", "주소",
  ...Object.keys(DERIVED_FIELD_SOURCES),   // 서버가 원천 칸으로 만드는 파생 표기(주말급여합계·출근시각12·퇴근시각12) — 원천 칸만 열로 둔다
]);
const KEY_NAMES = new Set(["사번", "사원번호", "이름", "직원명", "직원", "성명"]);
// 사람마다 다를 수 있는 날짜 칸 — 근로시작일·교육/실무평가 기간(2026-10-16 이예지 QA: 입사일이 다른 신규입사자를 한 번에 만들면 평가 기간이 모두 같아졌다).
// 평가 4칸은 비워 두면 그 사람 근로시작일(없으면 계약시작일)로 자동 계산하고, 적으면 적은 값이 우선이다
export const PERSON_DATE_COLS = ["근로시작일", "교육평가시작", "교육평가종료", "실무평가시작", "실무평가종료"] as const;
export const EVAL_COLS = ["교육평가시작", "교육평가종료", "실무평가시작", "실무평가종료"] as const;
export const DATE_COLS: readonly string[] = ["계약시작일", "계약종료일", ...PERSON_DATE_COLS];

/** 표에 보일 열 — 연봉(필요한 양식만) + 계약 기간 + 그 양식의 나머지 입력 칸 */
export function bulkColumns(templateFields: string[], needsSalary: boolean): string[] {
  const cols: string[] = [];
  if (needsSalary) cols.push("연봉");
  cols.push("계약시작일", "계약종료일");
  for (const f of PERSON_DATE_COLS) if (templateFields.includes(f)) cols.push(f);
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

/** 교육·실무평가 단계(작성 화면·여러 명 표·발송이 모두 이 함수) — 2026-10-21 이예지 대리(근로계약서 제3조 ①1·2호·제8조 ④⑤):
 *  교육평가 = 입과일(= 입사일) ~ 그 기수의 루트코스 수료일(일정표 — lib/route-course), 실무평가 = 수료일 다음 날 ~ 입사일 + 3개월 − 1일.
 *  일정표에 없는 입과일이면 null — 자동으로 채우지 않고 빈칸(빨간 줄)으로 둔다. 종전(10/20)은 「입과일 + 17일」 고정이라 공휴일이 끼면 하루씩 어긋났다 */
export function evalPeriods(start: string, cohorts: Cohort[]): Record<string, string> | null {
  return evalPeriodsFor(start, cohorts);
}
/** 일정표에 없어 비워 둘 때 — 평가 칸 넷을 빈 값으로 */
export const EMPTY_EVAL: Record<string, string> = { 교육평가시작: "", 교육평가종료: "", 실무평가시작: "", 실무평가종료: "" };

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

/** 사람마다 「보내기 전 확인」 결과(계약서 보내기 2단계, 2026-10-20 시안 v2 3번) — error = 고치거나 빼야 넘어감, warn = 「그래도 보내기」 또는 빼기 */
export type RowStatus = { level: "ok" | "warn" | "error"; text: string; acked?: boolean };

export default function BulkValuesTable({ userIds, employees, columns, values, onChange, common, rowCommon, status, onRemove, onAck, onlyIssues, salaryInfo, onSalaryConfirm, fieldTypes }: {
  fieldTypes?: Record<string, { type: string; options?: string[] }>; // 고르는 칸(주휴일지정 등) — 사람별 칸도 드롭다운으로
  userIds: string[];
  employees: Emp[];
  columns: string[];
  values: BulkRowValues;
  onChange: (v: BulkRowValues) => void;
  common: Record<string, string>; // 비었을 때 회색으로 보여 줄 공통값
  rowCommon?: Record<string, Record<string, string>>; // 사람마다 달리 들어가는 값(근로시작일=각자 입사일·평가 기간) — 공통값보다 먼저 보인다(10/16 이예지 재확인 2)
  status?: Record<string, RowStatus>;   // 있으면 「상태」 열·빨간 줄(계약서 보내기)
  onRemove?: (uid: string) => void;     // 줄 빼기(×)
  onAck?: (uid: string) => void;        // 경고 줄 「그래도 보내기」
  onlyIssues?: boolean;                 // 「확인 필요」만 보기
  // 연봉 확인(2026-10-23 본부) — 사람마다 들어갈 연봉(value)·확인 여부·출처 한 줄(「포털 연봉 · 2026-03-01~」). 있으면 연봉 칸 아래 「확인」 체크
  salaryInfo?: Record<string, { value: string; confirmed: boolean; note: string }>;
  onSalaryConfirm?: (uid: string, on: boolean) => void;
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
      for (const k of DATE_COLS) if (columns.includes(k) && row[k] && normDate(row[k]) === null) problems.push(`${emp(uid)?.name}: ${k} 「${row[k]}」을(를) 날짜로 읽지 못했습니다`);
    }
    onChange(next);
    if (problems.length) toast.warning(`${used}명 넣음 — 확인할 것: ${problems.slice(0, 5).join(" / ")}${problems.length > 5 ? ` 외 ${problems.length - 5}건` : ""}`, { duration: 15000 });
    else toast.success(`${used}명 값을 넣었습니다. 표에서 확인해 주세요.`);
    setPaste("");
  };

  if (!userIds.length || (!columns.length && !status)) return null;
  // 사람마다 「연봉 확인」 체크 — 값이 비면 누를 수 없고, 값이 바뀌면 화면이 확인을 푼다(ContractsScreen salaryOk)
  const salaryCheck = (uid: string) => {
    const si = salaryInfo?.[uid];
    if (!si) return null;
    return (
      <div className="pl-1 pt-0.5 text-[12px] leading-tight">
        {si.note && <div className="text-gray-400 whitespace-nowrap">{si.note}</div>}
        <label className={`inline-flex items-center gap-1 whitespace-nowrap ${si.confirmed ? "text-indigo-700" : "text-red-600 font-semibold"} ${si.value ? "cursor-pointer" : "opacity-60"}`}>
          <input type="checkbox" checked={si.confirmed} disabled={!si.value} onChange={(ev) => onSalaryConfirm?.(uid, ev.target.checked)} />
          {si.confirmed ? "연봉 확인함" : "연봉 확인"}
        </label>
      </div>
    );
  };
  const issue = (uid: string) => { const st = status?.[uid]; return !!st && (st.level === "error" || (st.level === "warn" && !st.acked)); };
  const shown = onlyIssues ? userIds.filter(issue) : userIds;
  return (
    <div className="space-y-2 border border-blue-200 rounded-lg p-3 bg-blue-50/40">
      <p className="text-xs font-semibold text-blue-800">개인별 값 — 비워 두면 위 공통 입력값이 들어갑니다{columns.some((c) => (EVAL_COLS as readonly string[]).includes(c)) ? " · 평가 기간을 비우면 그 사람 근로시작일로 자동 계산" : ""}</p>
      <div className="overflow-x-auto max-h-72 overflow-y-auto rounded border bg-white">
        <table className="text-xs w-full">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">직원</th>
              {columns.map((c) => <th key={c} className="px-2 py-1.5 text-left font-medium whitespace-nowrap">{c}</th>)}
              {status && <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">상태</th>}
              {onRemove && <th className="px-1 py-1.5" />}
            </tr>
          </thead>
          <tbody>
            {shown.map((uid) => {
              const e = emp(uid);
              const st = status?.[uid];
              return (
                <tr key={uid} id={`bulk-row-${uid}`} className={`border-t scroll-mt-24 ${issue(uid) ? "bg-red-50/70" : ""}`}>
                  <td className="px-2 py-1 whitespace-nowrap">{e?.name}{e?.empNo != null ? <span className="text-gray-400"> {String(e.empNo).padStart(5, "0")}</span> : null}{e?.branch ? <span className="text-gray-400"> · {e.branch}</span> : null}
                    {!columns.includes("연봉") && salaryCheck(uid)}
                  </td>
                  {columns.map((c) => {
                    const v = values[uid]?.[c] ?? "";
                    const bad = DATE_COLS.includes(c) && v && normDate(v) === null;
                    // 노란 칸 = 공통 값과 다르게 고친 칸(시안 v2) · 연봉은 한글 금액을 붙여 자릿수 실수를 막는다
                    const base = rowCommon?.[uid]?.[c] ?? common[c] ?? "";
                    const shownVal = v || base;
                    const diff = !!v && v.trim() !== String(base).trim();   // 공통 값과 다르게 고친 칸만 노랗게(재검증)
                    const won = c === "연봉" ? Number(shownVal.replace(/[^0-9]/g, "")) : 0;
                    return (
                      <td key={c} className="px-1 py-0.5 align-top">
                        {fieldTypes?.[c]?.type === "select" ? (
                          <select value={v} onChange={(ev) => set(uid, c, ev.target.value)}
                            className={`w-28 rounded border px-1 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-300 ${diff ? "border-amber-300 bg-amber-50" : "border-gray-200"}`}>
                            <option value="">{base ? `공통(${base})` : "선택"}</option>
                            {(fieldTypes[c]?.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                        <input value={v} placeholder={rowCommon?.[uid]?.[c] ?? common[c] ?? ""}
                          onChange={(ev) => set(uid, c, ev.target.value)}
                          className={`w-28 rounded border px-1.5 py-1 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-300 ${bad ? "border-red-400 bg-red-50" : diff ? "border-amber-300 bg-amber-50" : "border-gray-200"}`} />
                        )}
                        {c === "연봉" && won > 0 && <div className="pl-1 text-[12px] font-semibold text-indigo-600 whitespace-nowrap">{koreanMoney(won)}</div>}
                        {c === "연봉" && salaryCheck(uid)}
                      </td>
                    );
                  })}
                  {status && (
                    <td className="px-2 py-1 text-xs align-top min-w-[160px]">
                      {!st ? <span className="text-gray-400">확인 중…</span>
                        : st.level === "ok" ? <span className="text-indigo-700">✓ 준비됨</span>
                        : st.level === "warn" && st.acked ? <span className="text-gray-600">✓ 그래도 보냄 <span className="text-gray-400">({st.text})</span></span>
                        : (
                          <span className={st.level === "error" ? "text-red-600" : "text-amber-700"}>
                            ! {st.text}
                            {st.level === "warn" && onAck && <button type="button" onClick={() => onAck(uid)} className="ml-1 underline">그래도 보내기</button>}
                          </span>
                        )}
                    </td>
                  )}
                  {onRemove && (
                    <td className="px-1 py-1 align-top">
                      <button type="button" onClick={() => onRemove(uid)} title="이 사람 빼기" aria-label={`${e?.name ?? "이 사람"} 빼기`} className="text-gray-400 hover:text-red-600 px-1">×</button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {columns.length > 0 && <div className="flex gap-2 items-start">
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={2}
          placeholder={`엑셀에서 여러 줄을 복사해 붙여넣기 — 첫 줄에 열 이름(사번·${columns.slice(0, 3).join("·")}…)을 넣으면 그 순서로`}
          className="flex-1 rounded border px-2 py-1 text-xs resize-none" />
        <button type="button" onClick={applyPaste} disabled={!paste.trim()}
          className="shrink-0 rounded bg-blue-600 px-3 py-1.5 text-xs text-white disabled:bg-gray-300">표에 넣기</button>
      </div>}
    </div>
  );
}
