"use client";

// 설정 › 권한 설정 — 세 탭(2026-10-23 본부 시안 S3): 「켜고 끄는 권한」(R15 그대로) · 「역할별로 할 수 있는 일」(보기 전용 표) · 「고정된 규칙」.
// 표는 분야 하나씩(분야 고르기) — 기능 이름 · 참고는 사람 말만(개발용 주소 · 작업 기록 번호는 lib/permission-matrix 주석에만).
// 알약은 누르지 않는 표시(마우스 효과 없음). 스위치를 바꾸면 표도 바로 따라온다.
import { useState } from "react";
import { Table2 } from "lucide-react";
import { PageHead, PillTabs, Box, tableClass, inputClass } from "@/components/kit";
import { cn } from "@/lib/utils";
import { PERMISSION_MATRIX, GRANT_LABEL, applyToggles, type Grant } from "@/lib/permission-matrix";
import type { PermissionSettings, PermissionToggle } from "@/lib/permission-settings";
import PermissionToggles, { FixedRules } from "@/components/admin/PermissionToggles";

type Fixed = { label: string; state: string; why: string };
type Tab = "toggles" | "matrix" | "fixed";

function Lv({ v }: { v: Grant }) {
  const label = GRANT_LABEL[v] ?? v;
  if (v === "na") return <span className="text-[#cbd5e1]">—</span>;
  // 시안 S3 .lv — 전체 진회색 면 · 담당 지점 옅은 회색 면 · 본인(그 밖 설명 글) 흰 바탕 테두리 · 안 됨 흰 바탕 점선
  const cls = v === "all" ? "bg-[#e2e8f0] text-[#1e293b]" : v === "branch" ? "bg-[#f1f5f9] text-[#334155]"
    : v === "no" ? "border border-dashed border-[#cbd5e1] bg-white text-[#64748b]" : "border border-[#cbd5e1] bg-white text-[#334155]";
  return <span className={cn("inline-block min-w-[84px] whitespace-nowrap rounded-full px-[11px] py-[3px] text-center text-[12.5px] font-bold", cls)}>{label}</span>;
}

export default function PermissionsScreen({ initial, toggles, fixed }: { initial: PermissionSettings; toggles: PermissionToggle[]; fixed: Fixed[] }) {
  const [tab, setTab] = useState<Tab>("toggles");
  const [settings, setSettings] = useState<PermissionSettings>(initial);
  const [area, setArea] = useState<string>(PERMISSION_MATRIX[0].title);
  const sections = area === "all" ? PERMISSION_MATRIX : PERMISSION_MATRIX.filter((s) => s.title === area);
  const others = PERMISSION_MATRIX.filter((s) => s.title !== area).map((s) => s.title);

  return (
    <div>
      <PageHead crumb="설정 › 권한 설정" title="권한 설정"
        note={tab === "matrix"
          ? <>이 표는 보기 전용 · 바꾸는 곳은 <button type="button" onClick={() => setTab("toggles")} className="font-semibold text-[#4f46e5] hover:underline">「켜고 끄는 권한」 탭 ›</button></>
          : "바꾸면 바로 적용 · 변경 로그에 남음"} />
      <PillTabs value={tab} onChange={(k) => setTab(k as Tab)} tabs={[
        { key: "toggles", label: "켜고 끄는 권한" },
        { key: "matrix", label: "역할별로 할 수 있는 일" },
        { key: "fixed", label: "고정된 규칙" },
      ]} />

      {/* 스위치 칸은 숨겨도 남겨 둔다 — 탭을 오가도 저장 중 상태 · 값이 그대로 */}
      <div hidden={tab !== "toggles"}>
        <PermissionToggles initial={initial} toggles={toggles} fixed={fixed} showFixed={false} onChange={setSettings} />
      </div>

      {tab === "matrix" && (
        <Box icon={<Table2 />} tone="ind" title={area === "all" ? "모든 분야" : area} sub="지금 설정 기준"
          right={
            <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="분야 고르기" className={cn(inputClass, "min-h-11 font-semibold sm:min-h-0")}>
              {PERMISSION_MATRIX.map((s) => <option key={s.title} value={s.title}>분야: {s.title}</option>)}
              <option value="all">분야: 모두</option>
            </select>
          }>
          <p className="border-b border-[#eef1f5] px-6 py-3 text-[13px] text-[#475569]">표 읽는 법 — 전체 = 모든 지점 · 담당 지점 = 내 지점만 · 본인 = 내 것만 · 안 됨 = 못 함</p>
          {sections.map((sec) => (
            <div key={sec.title} className="overflow-x-auto">
              {area === "all" && <p className="border-b border-[#eef1f5] bg-[#fafbfd] px-6 pb-2 pt-4 text-[14px] font-bold text-[#0f172a]">{sec.title}</p>}
              <table className={tableClass}>
                <thead>
                  <tr>
                    <th className="w-[34%]">할 수 있는 일</th>
                    <th className="!text-center">본부</th>
                    <th className="!text-center">원장</th>
                    <th className="!text-center">직원</th>
                    <th>참고</th>
                  </tr>
                </thead>
                <tbody>
                  {sec.rows.map((row) => { const r = applyToggles(row, settings); return (
                    <tr key={r.feature}>
                      <td className="font-bold text-[#0f172a]">{r.feature}</td>
                      <td className="text-center"><Lv v={r.admin} /></td>
                      <td className="text-center"><Lv v={r.manager} /></td>
                      <td className="text-center"><Lv v={r.employee} /></td>
                      <td className="text-[13px] text-[#475569]">
                        {r.note}
                        {r.diff && <span className="mt-0.5 block font-semibold text-[#b45309]">시프티와 다름: {r.diff}</span>}
                      </td>
                    </tr>
                  ); })}
                </tbody>
              </table>
            </div>
          ))}
          {area !== "all" && (
            <button type="button" onClick={() => setArea("all")} className="flex min-h-11 w-full items-center border-t border-[#eef1f5] px-6 py-3 text-left text-[14px] font-semibold text-[#4f46e5] hover:bg-[#f8fafc]">
              {others.join(" · ")}도 같은 표로 보기 ›
            </button>
          )}
          <p className="border-t border-[#eef1f5] px-6 py-3 text-[12.5px] text-[#596578]">
            원장의 「담당 지점」은 대표 지점과 겸직 지점을 합친 범위입니다. 원장대행은 정해 둔 기간 동안 그 지점 원장의 결재(계약서 서명 빼고)를 합니다.
          </p>
        </Box>
      )}

      {tab === "fixed" && <FixedRules fixed={fixed} defaultOpen />}
    </div>
  );
}
