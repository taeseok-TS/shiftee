import { getSession } from "@/lib/auth";
import { Users, MoreVertical } from "lucide-react";
import { PageHead, Box, Cell2, StatusPill, tableClass, type PillTone } from "@/components/kit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { fmtDayKo } from "@/lib/leave-period";
import { jobGroupLabel } from "@/lib/job-group-label";

// 원장 「인사 › 지점 직원」 — R14(관리자 인사 › 직원)와 같은 박스 · 표. 원장은 보기만이라 엑셀 올리기 · 직원 추가 버튼은 없다.
// 표(md 이상): 사번 · 이름(+ 메일 회색 한 줄) · 역할 알약 · 직책 · 직급 · 지점 · 입사일 · ⋮(지금 있는 동작 — 직원의 연차 대장 보기)
// 폰(md 미만): 카드 — 머리글이 한 글자씩 세로로 쌓이던 것(2026-10-23 오픈 전 요청 ■2 · ■4). 표와 같은 값(사번 · 역할 알약 · 입사일)을 쓴다
const roleLabel: Record<string, string> = { ADMIN: "관리자", MANAGER: "원장", EMPLOYEE: "직원" };
const roleTone: Record<string, PillTone> = { ADMIN: "rej", MANAGER: "ind", EMPLOYEE: "gray" };   // 직원 회색 · 원장 연인디고(R14)
const fmtEmpNo = (n: number | null | undefined) => (n == null ? "-" : String(n).padStart(5, "0"));
const KST_MS = 9 * 3600_000;
const ymd = (d: Date) => {
  const k = new Date(d.getTime() + KST_MS);   // KST 날짜(서버는 UTC)
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-${String(k.getUTCDate()).padStart(2, "0")}`;
};
// 입사일 「10월 31일 (토)」 — 올해가 아니면 「2024년 10월 31일 (토)」(공통 규칙 ■4). 표 · 카드가 같은 글자를 쓴다
function hireLabel(hireDate: Date | null | undefined): string {
  if (!hireDate) return "-";
  const day = ymd(new Date(hireDate));
  const thisYear = new Date(Date.now() + KST_MS).getUTCFullYear();
  return fmtDayKo(day, Number(day.slice(0, 4)) !== thisYear);
}

type Row = { id: string; name: string; email: string | null; empNo: number | null; position: string | null; jobGroup: string | null; branch: string | null; role: string; hireDate: Date | null };

// 역할 알약 — 표 · 카드 공통
const RolePill = ({ role }: { role: string }) => <StatusPill tone={roleTone[role] ?? "gray"}>{roleLabel[role] || role}</StatusPill>;
// ⋮ — 직원에게만(원장 줄은 동작이 없어 ⋮ 도 없다). 옛 「연차 · 대장 보기」 칸 → ⋮ 안(R14)
const MoreOf = ({ employee, big = false }: { employee: Row; big?: boolean }) => employee.role === "EMPLOYEE" ? (
  <DropdownMenu>
    <DropdownMenuTrigger className={`inline-flex items-center justify-center rounded-md text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#475569] ${big ? "h-11 w-11" : "h-8 w-7"}`} aria-label="더 보기">
      <MoreVertical size={17} />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-40">
      <DropdownMenuItem render={<a href={`/manager/leave-ledger?userId=${employee.id}`} />}>연차 대장 보기</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
) : null;

export default async function ManagerEmployeesPage() {
  const session = await getSession();

  // 담당 지점 = 대표 지점 + 겸직 지점. session.branch 는 토큰에 박제된 값이라 단독으로 쓰지 않는다
  const myBranches = session ? await getManagerBranches(session.userId) : [];

  // 담당 지점에 속한 직원만 조회
  const employees: Row[] = await prisma.user.findMany({
    where: {
      role: { not: "ADMIN" },
      isActive: true,
      deletedAt: null,
      branch: { in: myBranches },
    },
    select: {
      id: true,
      empNo: true,
      name: true,
      email: true,
      position: true,
      jobGroup: true,
      branch: true,
      role: true,   // 대장 링크는 직원에게만(원장은 담당 지점 **직원**의 대장만 본다)
      hireDate: true,
    },
    orderBy: [{ name: "asc" }],
  });

  // 본부 계정이 원장 모드로 열면 담당 지점이 없다 — 데이터 범위는 그대로, 문구만 사람 말로(2026-10-23 ■2)
  const noBranch = myBranches.length === 0;

  return (
    <div>
      <PageHead crumb="인사 › 지점 직원" title="지점 직원" note={noBranch ? "담당 지점이 없습니다" : myBranches.join(" · ")} />

      <Box icon={<Users />} tone="sky" title="직원 목록" sub={`${employees.length}명`}>
        {employees.length === 0 ? (
          <div className="p-8 text-center text-[14px] text-[#596578]">{noBranch ? "담당 지점이 없습니다. 담당 지점이 정해지면 그 지점 직원이 여기에 나옵니다." : "직원이 없습니다."}</div>
        ) : (<>
          {/* 폰 카드 — 이름(옆에 직급 · 직책) / 사번 · 역할 · 지점 / 입사일, 오른쪽 ⋮ */}
          <div className="divide-y divide-[#f1f5f9] md:hidden">
            {employees.map((employee) => {
              const rank = [...new Set([jobGroupLabel(employee.position), jobGroupLabel(employee.jobGroup)].filter(Boolean))].join(" · ");
              return (
                <div key={employee.id} className="flex items-start gap-2 px-4 py-3.5">
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="min-w-0 leading-snug">
                      <b className="text-[16px] font-bold text-[#0f172a]">{employee.name}</b>
                      {rank && <span className="ml-1.5 text-[13px] text-[#596578]">{rank}</span>}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13.5px] text-[#475569]">
                      <span className="font-mono text-[13px] text-[#596578]">{fmtEmpNo(employee.empNo)}</span>
                      <span className="text-[#cbd5e1]">·</span>
                      <RolePill role={employee.role} />
                      <span className="text-[#cbd5e1]">·</span>
                      <span>{employee.branch || "-"}</span>
                    </p>
                    <p className="text-[13.5px] text-[#475569]"><span className="text-[#596578]">입사일</span> {hireLabel(employee.hireDate)}</p>
                  </div>
                  <div className="-mr-2 -mt-1.5 shrink-0"><MoreOf employee={employee} big /></div>
                </div>
              );
            })}
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className={tableClass}>
              <thead>
                <tr>
                  <th>사번</th>
                  <th>이름</th>
                  <th>역할</th>
                  <th>직책</th>
                  <th>직급</th>
                  <th>지점</th>
                  <th>입사일</th>
                  <th className="w-12"><span className="sr-only">더 보기</span></th>
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id} className="hover:bg-[#fafbfd]">
                    <td className="font-mono text-[13px] text-[#596578]">{fmtEmpNo(employee.empNo)}</td>
                    <td><Cell2 main={employee.name} sub={employee.email} /></td>
                    <td><RolePill role={employee.role} /></td>
                    <td className="text-[#475569]">{jobGroupLabel(employee.jobGroup) || "-"}</td>
                    <td className="text-[#475569]">{employee.position || "-"}</td>
                    <td className="text-[#475569]">{employee.branch || "-"}</td>
                    <td className="whitespace-nowrap tabular-nums text-[#475569]">{hireLabel(employee.hireDate)}</td>
                    <td className="text-right"><MoreOf employee={employee} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>)}
      </Box>
    </div>
  );
}
