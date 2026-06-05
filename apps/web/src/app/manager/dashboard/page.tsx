import { getSession } from "@/lib/auth";

export default async function ManagerDashboardPage() {
  const session = await getSession();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">팀 관리 대시보드</h2>
        <p className="text-gray-600 mt-2">
          {session?.branch} - 팀 관리 및 모니터링
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium">팀 인원</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">--</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium">대기 중인 계약</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">--</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium">대기 중인 휴가 승인</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">--</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium">금월 결근자</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">--</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">팀 관리</h3>
        <div className="grid grid-cols-2 gap-4">
          <a
            href="/manager/team-employees"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">팀 직원</div>
            <div className="text-sm text-gray-600">팀 직원 정보 관리</div>
          </a>
          <a
            href="/manager/team-leave"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">팀 휴가</div>
            <div className="text-sm text-gray-600">휴가 신청 및 승인</div>
          </a>
          <a
            href="/manager/team-contracts"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">팀 계약서</div>
            <div className="text-sm text-gray-600">계약서 관리</div>
          </a>
          <a
            href="/manager/team-schedule"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">팀 일정</div>
            <div className="text-sm text-gray-600">팀 근무 일정</div>
          </a>
        </div>
      </div>
    </div>
  );
}
