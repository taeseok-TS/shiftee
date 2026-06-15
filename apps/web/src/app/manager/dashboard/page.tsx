"use client";

import { useState, useEffect } from "react";

type TeamStats = {
  teamCount: number;
  attendance: { present: number; late: number; absent: number; earlyLeave: number; onLeave: number };
  pendingContracts: number;
  pendingApprovals: number;
  monthAbsent: number;
};

export default function ManagerDashboardPage() {
  const [branch, setBranch] = useState("");
  const [stats, setStats] = useState<TeamStats | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => setBranch(d.user?.branch || d.branch || ""))
      .catch(() => {});
    fetch("/api/manager/dashboard-stats")
      .then(r => (r.ok ? r.json() : null))
      .then(d => d && setStats(d))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">팀 관리 대시보드</h2>
        <p className="text-gray-600 mt-2">
          {branch ? `${branch} - ` : ""}팀 관리 및 모니터링
        </p>
      </div>

      {/* 오늘 팀 근무 현황 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-3">오늘 팀 근무 현황</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-gray-500 text-sm font-medium">출근</div>
            <div className="text-3xl font-bold text-blue-600 mt-2">
              {stats ? stats.attendance.present : "--"}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-gray-500 text-sm font-medium">지각</div>
            <div className="text-3xl font-bold text-orange-600 mt-2">
              {stats ? stats.attendance.late : "--"}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-gray-500 text-sm font-medium">미출근</div>
            <div className="text-3xl font-bold text-red-600 mt-2">
              {stats ? stats.attendance.absent : "--"}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-gray-500 text-sm font-medium">조퇴</div>
            <div className="text-3xl font-bold text-yellow-600 mt-2">
              {stats ? stats.attendance.earlyLeave : "--"}
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-5">
            <div className="text-gray-500 text-sm font-medium">휴가</div>
            <div className="text-3xl font-bold text-green-600 mt-2">
              {stats ? stats.attendance.onLeave : "--"}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <a href="/manager/team-employees" className="bg-white rounded-lg shadow p-6 hover:shadow-md transition block">
          <div className="text-gray-500 text-sm font-medium">팀 인원</div>
          <div className="text-3xl font-bold text-blue-600 mt-2">
            {stats ? `${stats.teamCount}명` : "--"}
          </div>
        </a>
        <a href="/manager/team-contracts" className="bg-white rounded-lg shadow p-6 hover:shadow-md transition block">
          <div className="text-gray-500 text-sm font-medium">대기 중인 계약</div>
          <div className="text-3xl font-bold text-purple-600 mt-2">
            {stats ? `${stats.pendingContracts}건` : "--"}
          </div>
          <p className="text-xs text-gray-400 mt-1">서명 대기</p>
        </a>
        <a href="/manager/team-leave" className="bg-white rounded-lg shadow p-6 hover:shadow-md transition block">
          <div className="text-gray-500 text-sm font-medium">대기 중인 결재</div>
          <div className="text-3xl font-bold text-amber-600 mt-2">
            {stats ? `${stats.pendingApprovals}건` : "--"}
          </div>
          <p className="text-xs text-gray-400 mt-1">휴가 + 근무일정</p>
        </a>
        <div className="bg-white rounded-lg shadow p-6">
          <div className="text-gray-500 text-sm font-medium">금월 결근자</div>
          <div className="text-3xl font-bold text-red-600 mt-2">
            {stats ? `${stats.monthAbsent}명` : "--"}
          </div>
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
