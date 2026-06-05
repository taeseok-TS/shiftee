import { getSession } from "@/lib/auth";

export default async function ManagerContractsPage() {
  const session = await getSession();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">팀 계약서 관리</h2>
        <p className="text-gray-600 mt-2">{session?.branch} - 팀의 계약서 조회 및 관리</p>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-semibold text-blue-900 mb-2">준비 중</h3>
        <p className="text-blue-800">
          팀의 계약서를 조회하고 관리할 수 있는 기능이 곧 추가됩니다.
        </p>
      </div>
    </div>
  );
}
