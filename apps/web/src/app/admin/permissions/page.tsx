import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Table2 } from "lucide-react";
import { PageHead, Box, tableClass } from "@/components/kit";
import { PERMISSION_MATRIX, GRANT_LABEL, type Grant, type PermRow } from "@/lib/permission-matrix";
import { PERMISSION_TOGGLES, FIXED_RULES, readPermissions, type PermissionSettings } from "@/lib/permission-settings";
import PermissionToggles from "@/components/admin/PermissionToggles";

// 권한 설정(2026-10-14 QA76 #39) — 위: 켜고 끄는 토글(원장·직원) + 고정 규칙, 아래: 역할별 권한 현황 표(토글 상태를 반영).
// 표의 원천은 lib/permission-matrix.ts(라우트를 바꾸면 표도 같이 고친다). 토글이 바꾸는 줄은 applyToggles 가 덮어쓴다.
export const dynamic = "force-dynamic";

function Cell({ v }: { v: Grant }) {
  const label = GRANT_LABEL[v] ?? v;
  // 칸 색(R15 — 초록 없음): 전체 파랑 · 담당 지점 연인디고 · 본인 주황 · 불가 회색
  const cls = v === "all" ? "bg-[#eff6ff] text-[#1d4ed8]" : v === "branch" ? "bg-[#eef2ff] text-[#4f46e5]" : v === "self" ? "bg-[#fffbeb] text-[#b45309]"
    : v === "no" ? "bg-[#f1f5f9] text-[#7c8798]" : v === "na" ? "text-[#cbd5e1]" : "bg-[#f5f3ff] text-[#6d28d9]";
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12.5px] font-bold ${cls}`}>{label}</span>;
}

/** 토글 상태를 현황 표에 반영 — 켜고 끄는 권한이 걸린 줄만 */
function applyToggles(row: PermRow, s: PermissionSettings): PermRow {
  const r = { ...row };
  if (row.feature === "출퇴근 기록 보기(달력·목록)") {
    r.manager = s["manager.viewAttendance"] ? "branch" : "본인만(설정 끔)";
    r.employee = s["employee.viewOwnAttendance"] ? "본인(웹·앱)" : "오늘 상태만(앱)";
  }
  if (row.feature === "출퇴근 통계") {
    r.manager = s["manager.viewAttendance"] ? "branch" : "본인만(설정 끔)";
  }
  if (row.feature === "잔여 연차 숫자 보기") {   // #219-1
    r.manager = s["employee.viewLeaveBalance"] ? "branch" : "숨김(연차 정리 중)";
    r.employee = s["employee.viewLeaveBalance"] ? "self" : "숨김(연차 정리 중)";
  }
  if (row.feature === "일정 추가·수정·삭제" || row.feature === "일정 일괄 생성") {
    r.manager = s["manager.editSchedule"] ? "branch" : "신청만(설정 끔)";
  }
  return r;
}

export default async function PermissionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");
  const settings = await readPermissions();
  return (
    <div>
      {/* 머리(R15) — 맨 위 긴 안내 문단 → 오른쪽 회색 한 줄 */}
      <PageHead crumb="설정 › 권한 설정" title="권한 설정" note="바꾸면 바로 적용 · 변경 로그에 남음" />

      <PermissionToggles initial={settings} toggles={PERMISSION_TOGGLES} fixed={FIXED_RULES} />

      {/* 역할별 권한 현황 — 같은 박스 · 같은 표(R15). 현재 설정이 반영된 값 */}
      {PERMISSION_MATRIX.map((sec, i) => (
        <Box key={sec.title} icon={<Table2 />} tone="sl" title={sec.title}
          sub={i === 0 ? "역할별 권한 현황 · 현재 설정 반영" : undefined}
          right={i === 0 ? <span className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-normal text-[#596578]"><Cell v="all" /> 전체 <Cell v="branch" /> 담당 지점 <Cell v="self" /> 본인 <Cell v="no" /> 불가</span> : undefined}>
          <div className="overflow-x-auto">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th className="w-[30%]">기능</th>
                  <th>본부(관리자)</th>
                  <th>원장</th>
                  <th>직원</th>
                  <th>비고</th>
                </tr>
              </thead>
              <tbody>
                {sec.rows.map((row) => { const r = applyToggles(row, settings); return (
                  <tr key={r.feature}>
                    <td className="text-[#0f172a]">{r.feature}<span className="block font-mono text-[11px] text-[#94a3b8]">{r.basis}</span></td>
                    <td><Cell v={r.admin} /></td>
                    <td><Cell v={r.manager} /></td>
                    <td><Cell v={r.employee} /></td>
                    <td className="text-[12.5px] text-[#596578]">
                      {r.note}
                      {r.diff && <span className="mt-0.5 block font-semibold text-[#b45309]">시프티와 다름: {r.diff}</span>}
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </div>
        </Box>
      ))}
      <p className="text-[12.5px] text-[#596578]">
        시프티 현재 설정(2026-10 기준): 원장 = 지점 출퇴근 열람·근무일정 관리 ON, 직원 추가·휴가 직접 등록·출퇴근 직접 수정 OFF / 직원 = 동료 일정·휴가 열람 OFF, 본인 출퇴근기록 열람 OFF.
        원장의 「담당 지점」은 대표 지점과 겸직 지점을 합친 범위이며, 원장대행은 지정 기간 동안 그 지점 원장의 결재 권한(계약서 서명 제외)을 갖습니다.
      </p>
    </div>
  );
}
