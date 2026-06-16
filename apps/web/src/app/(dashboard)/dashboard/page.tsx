"use client";

import { useState, useEffect } from "react";
import { Megaphone, Pin, FileText } from "lucide-react";
import { format } from "date-fns";

type MyStats = {
  leaveRemaining: number;
  pendingContracts: number;
  pendingApprovals: number;
  monthWorkHours: number;
};
type Announcement = { id: string; title: string; content: string; pinned: boolean; authorName: string; createdAt: string };

export default function SharedDashboardPage() {
  const [name, setName] = useState("");
  const [department, setDepartment] = useState("");
  const [stats, setStats] = useState<MyStats | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);

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
    fetch("/api/work/announcements")
      .then(r => (r.ok ? r.json() : null))
      .then(d => d && setAnnouncements((d.announcements || []).slice(0, 5)))
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

      {/* 공지사항 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Megaphone size={18} className="text-indigo-500" />공지사항
        </h3>
        {announcements.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">등록된 공지가 없습니다.</div>
        ) : (
          <div className="space-y-3">
            {announcements.map((a) => (
              <a key={a.id} href="/work/announcements"
                className={`flex gap-3 p-3 rounded-lg border transition-colors hover:bg-gray-50 ${a.pinned ? "bg-indigo-50 border-indigo-200" : "bg-white border-gray-200"}`}>
                {a.pinned ? <Pin size={18} className="text-indigo-500 flex-shrink-0 mt-0.5" /> : <FileText size={18} className="text-gray-400 flex-shrink-0 mt-0.5" />}
                <div className="min-w-0">
                  <strong className="text-gray-900">{a.title}</strong>
                  <p className="text-sm text-gray-600 line-clamp-2 whitespace-pre-wrap">{a.content}</p>
                  <p className="text-xs text-gray-400 mt-1">{a.authorName} · {format(new Date(a.createdAt), "M월 d일 HH:mm")}</p>
                </div>
              </a>
            ))}
            <a href="/work/announcements" className="block text-center text-xs text-indigo-500 hover:underline pt-1">전체 공지 보기 →</a>
          </div>
        )}
      </div>
    </div>
  );
}
