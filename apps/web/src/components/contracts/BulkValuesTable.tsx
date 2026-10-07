"use client";

import { useState } from "react";
import { toast } from "sonner";

/**
 * 여러 명 계약서 — 개인별 값 표(2026-10-07 QA #19 #34).
 * 행 = 직원, 열 = 그 양식에서 사람마다 다를 수 있는 칸(연봉·기간·근무시간 등). 비워 두면 위 공통 입력값을 쓴다.
 * 엑셀에서 여러 줄을 복사해 붙여넣을 수 있다 — 첫 줄이 열 이름이면 그 순서로, 아니면 화면 열 순서로 넣는다.
 * 각 줄의 첫 칸이 사번(숫자)이나 이름이면 그 직원 줄에, 아니면 위에서부터 차례로 넣는다.
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

/** 계약직 근로시간 자동 계산(작성 화면과 같은 공식) — 개인별 값으로 다시 계산한다 */
export function deriveHours(v: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  const inT = v["출근시각"] || "", outT = v["퇴근시각"] || "", rest = (v["휴게시간"] || "").trim();
  if (/^\d{2}:\d{2}$/.test(inT) && /^\d{2}:\d{2}$/.test(outT) && rest) {
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
  if (week > 0) out["월근로시간"] = String(Math.round((week + (week >= 15 ? Math.min((week / 40) * 8, 8) : 0)) * 4.345));
  return out;
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

  const applyPaste = () => {
    const lines = paste.replace(/\r/g, "").split("\n").filter((l) => l.trim());
    if (!lines.length) return;
    let cols = columns;
    let rows = lines.map((l) => l.split("\t"));
    // 첫 줄이 열 이름이면 그 순서로
    const head = rows[0].map((c) => c.trim());
    const known = head.filter((h) => columns.includes(h) || h === "사번" || h === "이름" || h === "직원명");
    let keyCol = -1;
    if (known.length >= 2) {
      cols = head;
      keyCol = head.findIndex((h) => h === "사번" || h === "이름" || h === "직원명");
      rows = rows.slice(1);
    }
    const next: BulkRowValues = { ...values };
    let order = 0, used = 0;
    for (const r of rows) {
      // 그 줄이 누구인가 — 사번·이름 열이 있으면 그 값, 없으면 첫 칸이 사번·이름인지, 아니면 차례대로
      const keyRaw = (keyCol >= 0 ? r[keyCol] : r[0] || "").trim();
      let uid = userIds.find((id) => { const e = emp(id); return !!e && (e.name === keyRaw || (e.empNo != null && Number(keyRaw) === e.empNo)); });
      let cells = r;
      if (keyCol < 0) {
        if (uid) { cells = r.slice(1); }   // 첫 칸이 사번·이름이었다
        else uid = userIds[order];
        order++;
      }
      if (!uid) continue;
      const row = { ...(next[uid] || {}) };
      cells.forEach((c, i) => {
        const col = cols[i];
        if (!col || col === "사번" || col === "이름" || col === "직원명" || !columns.includes(col)) return;
        row[col] = c.trim();
      });
      next[uid] = row; used++;
    }
    onChange(next);
    toast.success(`${used}명 값을 넣었습니다. 표에서 확인해 주세요.`);
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
                  <td className="px-2 py-1 whitespace-nowrap">{e?.name}{e?.branch ? <span className="text-gray-400"> · {e.branch}</span> : null}</td>
                  {columns.map((c) => (
                    <td key={c} className="px-1 py-0.5">
                      <input value={values[uid]?.[c] ?? ""} placeholder={common[c] ?? ""}
                        onChange={(ev) => set(uid, c, ev.target.value)}
                        className="w-28 rounded border border-gray-200 px-1.5 py-1 placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-300" />
                    </td>
                  ))}
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
