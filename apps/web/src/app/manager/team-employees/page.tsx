import { getSession } from "@/lib/auth";
import { Users, MoreVertical } from "lucide-react";
import { PageHead, Box, Cell2, StatusPill, tableClass, type PillTone } from "@/components/kit";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

// 원장 「인사 › 지점 직원」 — R14(관리자 인사 › 직원)와 같은 박스 · 표. 원장은 보기만이라 엑셀 올리기 · 직원 추가 버튼은 없다.
// 표: 사번 · 이름(+ 메일 회색 한 줄) · 역할 알약 · 직책 · 직급 · 지점 · 입사일 · ⋮(지금 있는 동작 — 직원의 연차 대장 보기)
const roleLabel: Record<string, string> = { ADMIN: "관리자", MANAGER: "원장", EMPLOYEE: "직원" };
const roleTone: Record<string, PillTone> = { ADMIN: "rej", MANAGER: "ind", EMPLOYEE: "gray" };   // 직원 회색 · 원장 연인디고(R14)
const fmtEmpNo = (n: number | null | undefined) => (n == null ? "-" : String(n).padStart(5, "0"));
const ymd = (d: Date) => {
  const k = new Date(d.getTime() + 9 * 3600_000);   // KST 날짜(서버는 UTC)
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-${String(k.getUTCDate()).padStart(2, "0")}`;
};

export default async function ManagerEmployeesPage() {
  const session = await getSession();

  // 담당 지점 = 대표 지점 + 겸직 지점. session.branch 는 토큰에 박제된 값이라 단독으로 쓰지 않는다
  const myBranches = session ? await getManagerBranches(session.userId) : [];

  // 담당 지점에 속한 직원만 조회
  const employees = await prisma.user.findMany({
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
      createdAt: true,
    },
    orderBy: [{ name: "asc" }],
  });

  return (
    <div>
      <PageHead crumb="인사 › 지점 직원" title="지점 직원" note={myBranches.join(" · ") || "담당 지점 없음"} />

      <Box icon={<Users />} tone="sky" title="직원 목록" sub={`${employees.length}명`}>
        {employees.length === 0 ? (
          <div className="p-8 text-center text-[14px] text-[#596578]">직원이 없습니다.</div>
        ) : (
          <div className="overflow-x-auto">
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
                    <td><StatusPill tone={roleTone[employee.role] ?? "gray"}>{roleLabel[employee.role] || employee.role}</StatusPill></td>
                    <td className="text-[#475569]">{employee.jobGroup || "-"}</td>
                    <td className="text-[#475569]">{employee.position || "-"}</td>
                    <td className="text-[#475569]">{employee.branch || "-"}</td>
                    <td className="whitespace-nowrap tabular-nums text-[#475569]">{employee.hireDate ? ymd(new Date(employee.hireDate)) : "-"}</td>
                    <td className="text-right">
                      {/* 옛 「연차 · 대장 보기」 칸 → ⋮ 안(R14). 직원에게만 — 원장 줄은 동작이 없어 ⋮ 도 없다 */}
                      {employee.role === "EMPLOYEE" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger className="inline-flex h-8 w-7 items-center justify-center rounded-md text-[#94a3b8] hover:bg-[#f1f5f9] hover:text-[#475569]" aria-label="더 보기">
                            <MoreVertical size={17} />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40">
                            <DropdownMenuItem render={<a href={`/manager/leave-ledger?userId=${employee.id}`} />}>연차 대장 보기</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>
    </div>
  );
}
