import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";
import { PERMISSION_MATRIX, GRANT_LABEL, type Grant, type PermRow } from "@/lib/permission-matrix";
import { PERMISSION_TOGGLES, FIXED_RULES, readPermissions, type PermissionSettings } from "@/lib/permission-settings";
import PermissionToggles from "@/components/admin/PermissionToggles";

// 권한 설정(2026-10-14 QA76 #39) — 위: 켜고 끄는 토글(원장·직원) + 고정 규칙, 아래: 역할별 권한 현황 표(토글 상태를 반영).
// 표의 원천은 lib/permission-matrix.ts(라우트를 바꾸면 표도 같이 고친다). 토글이 바꾸는 줄은 applyToggles 가 덮어쓴다.
export const dynamic = "force-dynamic";

function Cell({ v }: { v: Grant }) {
  const label = GRANT_LABEL[v] ?? v;
  const cls = v === "all" ? "bg-emerald-50 text-emerald-700" : v === "branch" ? "bg-blue-50 text-blue-700" : v === "self" ? "bg-amber-50 text-amber-700"
    : v === "no" ? "bg-gray-100 text-gray-400" : v === "na" ? "text-gray-300" : "bg-indigo-50 text-indigo-700";
  return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>{label}</span>;
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
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><ShieldCheck size={22} />권한 설정</h1>
        <p className="text-sm text-gray-500 mt-1">
          원장·직원의 권한을 켜고 끕니다. 바꾸면 바로 적용되고 감사 로그에 남습니다. 기본값은 시프티 설정값과 같습니다.
          설정으로 바꿀 수 없는 규칙은 「고정된 규칙」에 이유와 함께 적혀 있고, 아래 표는 현재 설정이 반영된 역할별 권한 현황입니다.
        </p>
      </div>

      <PermissionToggles initial={settings} toggles={PERMISSION_TOGGLES} fixed={FIXED_RULES} />

      <div className="pt-2">
        <h2 className="text-lg font-semibold text-gray-900">역할별 권한 현황</h2>
        <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
          <span><Cell v="all" /> 전체</span><span><Cell v="branch" /> 담당 지점(겸직 포함)만</span><span><Cell v="self" /> 본인 것만</span><span><Cell v="no" /> 불가</span><span><Cell v="na" /> 해당 없음</span>
        </div>
      </div>
      {PERMISSION_MATRIX.map((sec) => (
        <Card key={sec.title}>
          <CardHeader className="pb-2"><CardTitle className="text-base">{sec.title}</CardTitle></CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-gray-500 bg-gray-50/60 text-left">
                  <th className="px-4 py-2 font-medium w-[30%]">기능</th>
                  <th className="px-3 py-2 font-medium">본부(관리자)</th>
                  <th className="px-3 py-2 font-medium">원장</th>
                  <th className="px-3 py-2 font-medium">직원</th>
                  <th className="px-3 py-2 font-medium">비고</th>
                </tr>
              </thead>
              <tbody>
                {sec.rows.map((row) => { const r = applyToggles(row, settings); return (
                  <tr key={r.feature} className="border-b last:border-0 align-top">
                    <td className="px-4 py-2 text-gray-900">{r.feature}<span className="block text-[11px] text-gray-400 font-mono">{r.basis}</span></td>
                    <td className="px-3 py-2"><Cell v={r.admin} /></td>
                    <td className="px-3 py-2"><Cell v={r.manager} /></td>
                    <td className="px-3 py-2"><Cell v={r.employee} /></td>
                    <td className="px-3 py-2 text-xs text-gray-500">
                      {r.note}
                      {r.diff && <span className="block text-amber-700 mt-0.5">⚠ 시프티와 다름: {r.diff}</span>}
                    </td>
                  </tr>
                ); })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
      <p className="text-xs text-gray-400">
        시프티 현재 설정(2026-10 기준): 원장 = 지점 출퇴근 열람·근무일정 관리 ON, 직원 추가·휴가 직접 등록·출퇴근 직접 수정 OFF / 직원 = 동료 일정·휴가 열람 OFF, 본인 출퇴근기록 열람 OFF.
        원장의 「담당 지점」은 대표 지점과 겸직 지점을 합친 범위이며, 원장대행은 지정 기간 동안 그 지점 원장의 결재 권한(계약서 서명 제외)을 갖습니다.
      </p>
    </div>
  );
}
