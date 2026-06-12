"use client";

import { useState, useEffect } from "react";

type MyStats = {
  leaveRemaining: number;
  pendingContracts: number;
  pendingApprovals: number;
  monthWorkHours: number;
};

export default function SharedDashboardPage() {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [stats, setStats] = useState<MyStats | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => {
        setName(d.user?.name || "");
        setDepartment(d.user?.department || "");
      })
      .catch(() => {});
    fetch("/api/me/dashboard-stats")
      .then(r => (r.ok ? r.json() : null))
      .then(d => d && setStats(d))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">
          {name}님의 대시보드
        </h2>
        {department && <p className="text-gray-600 mt-2">{department}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a href="/leave" className="bg-white rounded-lg shadow p-6 hover:shadow-md transition block">
          <div className="text-gray-500 text-sm font-medium">나의 휴가 잔여</div>
          <div className="text-3xl font-bold text-blue-600 mt-2">
            {stats ? `${stats.leaveRemaining}일` : "--"}
          </div>
        </a>
        <a href="/contracts" className="bg-white rounded-lg shadow p-6 hover:shadow-md transition block">
          <div className="text-gray-500 text-sm font-medium">대기 중인 계약</div>
          <div className="text-3xl font-bold text-purple-600 mt-2">
            {stats ? `${stats.pendingContracts}건` : "--"}
          </div>
          <p className="text-xs text-gray-400 mt-1">서명 대기</p>
        </a>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium">결재 대기 건수</div>
          <div className="text-3xl font-bold text-amber-600 mt-2">
            {stats ? `${stats.pendingApprovals}건` : "--"}
          </div>
          <p className="text-xs text-gray-400 mt-1">내가 신청한 휴가·근무일정</p>
        </div>
        <a href="/attendance" className="bg-white rounded-lg shadow p-6 hover:shadow-md transition block">
          <div className="text-gray-500 text-sm font-medium">금월 근무 시간</div>
          <div className="text-3xl font-bold text-green-600 mt-2">
            {stats ? `${stats.monthWorkHours}시간` : "--"}
          </div>
        </a>
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">나의 업무</h3>
        <div className="grid grid-cols-2 gap-4">
          <a
            href="/contracts"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">내 계약서</div>
            <div className="text-sm text-gray-600">내 계약서 확인</div>
          </a>
          <a
            href="/leave"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">휴가 관리</div>
            <div className="text-sm text-gray-600">휴가 신청 및 조회</div>
          </a>
          <a
            href="/attendance"
            className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 transition"
          >
            <div className="font-medium text-gray-900">출퇴근</div>
            <div className="text-sm text-gray-600">출퇴근 기록</div>
          </a>
          <a
            href="/schedule"
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
