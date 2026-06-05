import { getSession } from "@/lib/auth";

export default async function SharedDashboardPage() {
  const session = await getSession();

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          {session?.name}님의 대시보드
        </h2>
        <p className="text-gray-600 mt-2">{session?.department}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium">나의 휴가 잔여</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">--</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium">대기 중인 계약</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">--</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium">결재 대기 건수</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">--</div>
        </div>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium">금월 근무 시간</div>
          <div className="text-3xl font-bold text-gray-900 mt-2">--</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">나의 업무</h3>
        <div className="grid grid-cols-2 gap-4">
          <a
            href="/shared/contracts"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">내 계약서</div>
            <div className="text-sm text-gray-600">내 계약서 확인</div>
          </a>
          <a
            href="/shared/leave"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">휴가 관리</div>
            <div className="text-sm text-gray-600">휴가 신청 및 조회</div>
          </a>
          <a
            href="/shared/attendance"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">출퇴근</div>
            <div className="text-sm text-gray-600">출퇴근 기록</div>
          </a>
          <a
            href="/shared/schedule"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">근무 일정</div>
            <div className="text-sm text-gray-600">내 근무 일정</div>
          </a>
        </div>
      </div>
    </div>
  );
}
