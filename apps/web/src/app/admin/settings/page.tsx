"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type AdminRow = { id: string; name: string; email: string; isSuperAdmin: boolean; createdAt: string };
type LogRow = { id: string; actorName: string; action: string; targetName: string | null; detail: string | null; createdAt: string };

const ACTION_LABEL: Record<string, string> = {
  LEAVE_BALANCE_UPDATE: "연차 수정",
  EMPLOYEE_UPDATE: "직원 정보 수정",
  EMPLOYEE_CREATE: "직원 생성",
  EMPLOYEE_DELETE: "직원 비활성화",
  EMPLOYEE_RESIGN: "퇴사 처리",
  EMPLOYEE_RESTORE: "직원 복구",
  LEAVE_DECISION: "휴가 결재",
  SCHEDULE_DECISION: "근무일정 결재",
};

export default function AdminSettingsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const loadSummary = () => {
    setLoadingData(true);
    fetch("/api/admin/summary")
      .then((r) => (r.ok ? r.json() : { admins: [], logs: [] }))
      .then((d) => { setAdmins(d.admins || []); setLogs(d.logs || []); })
      .catch(() => {})
      .finally(() => setLoadingData(false));
  };

  useEffect(() => { loadSummary(); }, []);

  // 서브 관리자 퇴사 처리 (메인 관리자만 — 백엔드에서 권한 검증)
  const handleResignAdmin = async (a: AdminRow) => {
    if (!confirm(`${a.name} 서브 관리자를 퇴사 처리할까요?\n계정이 비활성화되고 변경 로그에 기록됩니다.`)) return;
    const today = new Date().toISOString().slice(0, 10);
    try {
      const res = await fetch(`/api/employees/${a.id}/resign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resignDate: today, resignReason: "퇴사" }),
      });
      if (res.ok) {
        toast.success(`${a.name} 님을 퇴사 처리했습니다.`);
        loadSummary();
      } else {
        const e = await res.json().catch(() => ({}));
        toast.error(e.error || "퇴사 처리에 실패했습니다.");
      }
    } catch {
      toast.error("처리 중 오류가 발생했습니다.");
    }
  };

  const subAdminCount = admins.filter((a) => !a.isSuperAdmin).length;
  const fmt = (s: string) => {
    const d = new Date(s);
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const handleSaveSettings = async () => {
    setIsLoading(true);
    try {
      // TODO: Implement settings save logic
      toast.success("설정이 저장되었습니다.");
    } catch (error) {
      toast.error("설정 저장에 실패했습니다.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">시스템 설정</h1>
        <p className="text-gray-600 mt-2">시스템 관리자용 설정입니다.</p>
      </div>

      {/* 관리자 계정 현황 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>관리자 계정 현황 <span className="text-sm font-normal text-gray-500">· 서브 관리자 {subAdminCount}명</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingData ? (
            <p className="p-4 text-sm text-gray-400">불러오는 중…</p>
          ) : admins.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">관리자가 없습니다.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs text-gray-500 bg-gray-50/60 text-left">
                  <th className="px-4 py-2 font-medium">이름</th>
                  <th className="px-4 py-2 font-medium">이메일</th>
                  <th className="px-4 py-2 font-medium">구분</th>
                  <th className="px-4 py-2 font-medium">생성일</th>
                  <th className="px-4 py-2 font-medium text-right">관리</th>
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium text-gray-900">{a.name}</td>
                    <td className="px-4 py-2 text-gray-600">{a.email}</td>
                    <td className="px-4 py-2">
                      <span className={`text-xs rounded px-2 py-0.5 ${a.isSuperAdmin ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-600"}`}>
                        {a.isSuperAdmin ? "메인" : "서브"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-gray-500">{fmt(a.createdAt)}</td>
                    <td className="px-4 py-2 text-right">
                      {a.isSuperAdmin ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                          onClick={() => handleResignAdmin(a)}
                        >
                          퇴사 처리
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* 변경 로그 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>변경 로그 <span className="text-sm font-normal text-gray-500">· 최근 100건</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingData ? (
            <p className="p-4 text-sm text-gray-400">불러오는 중…</p>
          ) : logs.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">기록된 변경 이력이 없습니다.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b text-xs text-gray-500 bg-gray-50 text-left">
                    <th className="px-4 py-2 font-medium w-36">시간</th>
                    <th className="px-4 py-2 font-medium">행위자</th>
                    <th className="px-4 py-2 font-medium">작업</th>
                    <th className="px-4 py-2 font-medium">내용</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-b last:border-0 align-top">
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmt(l.createdAt)}</td>
                      <td className="px-4 py-2 text-gray-900 whitespace-nowrap">{l.actorName}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="text-xs rounded px-2 py-0.5 bg-blue-50 text-blue-700">{ACTION_LABEL[l.action] || l.action}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-700">{l.detail || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>시스템 알림</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium text-gray-900">시스템 로그 알림</p>
              <p className="text-sm text-gray-600">시스템 오류 발생 시 알림을 받습니다.</p>
            </div>
            <input type="checkbox" defaultChecked className="w-5 h-5" />
          </div>
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium text-gray-900">사용자 활동 알림</p>
              <p className="text-sm text-gray-600">비정상 사용자 활동 시 알림을 받습니다.</p>
            </div>
            <input type="checkbox" defaultChecked className="w-5 h-5" />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>백업 설정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">마지막 백업: 2일 전</p>
            <Button variant="outline" className="mt-4">자동 백업 설정</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>보안 설정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium text-gray-900">2단계 인증</p>
              <p className="text-sm text-gray-600">관리자 계정에 2단계 인증을 활성화합니다.</p>
            </div>
            <input type="checkbox" className="w-5 h-5" />
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 flex gap-3">
        <Button onClick={handleSaveSettings} disabled={isLoading}>
          {isLoading ? "저장 중..." : "저장"}
        </Button>
        <Button variant="outline">취소</Button>
      </div>
    </div>
  );
}
