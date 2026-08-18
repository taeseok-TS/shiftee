import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

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
      name: true,
      email: true,
      position: true,
      jobGroup: true,
      branch: true,
      hireDate: true,
      createdAt: true,
    },
    orderBy: [{ name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">팀 직원 관리</h2>
        <p className="text-gray-600 mt-2">{myBranches.join(" · ") || "담당 지점 없음"} - 총 {employees.length}명</p>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">이름</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">이메일</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">직책</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">직급</th>
              <th className="px-6 py-3 text-left text-sm font-semibold text-gray-900">입사일</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {employees.map((employee) => (
              <tr key={employee.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm text-gray-900">{employee.name}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{employee.email}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{employee.jobGroup || "-"}</td>
                <td className="px-6 py-4 text-sm text-gray-600">{employee.position || "-"}</td>
                <td className="px-6 py-4 text-sm text-gray-600">
                  {employee.hireDate ? new Date(employee.hireDate).toLocaleDateString("ko-KR") : "-"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {employees.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">직원이 없습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
