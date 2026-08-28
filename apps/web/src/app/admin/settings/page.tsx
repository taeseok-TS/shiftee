"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

type AdminRow = { id: string; name: string; email: string; phone: string | null; isSuperAdmin: boolean; createdAt: string; hireDate: string | null; birthDate: string | null; position: string | null; jobGroup: string | null; isContractApprover?: boolean };
type LogRow = { id: string; actorName: string; action: string; targetName: string | null; detail: string | null; createdAt: string };
type LoginFailRow = { id: string; email: string; userName: string | null; reason: string; deviceName: string | null; platform: string | null; createdAt: string };
const FAIL_REASON: Record<string, { label: string; tip: string }> = {
  UNKNOWN_EMAIL: { label: "없는 이메일", tip: "이메일 오타 가능성 — 정확한 주소를 안내" },
  BAD_PASSWORD: { label: "비밀번호 불일치", tip: "본인 셀프 재설정 안내(로그인 화면) 또는 직원관리에서 초기화(12345678)" },
  INACTIVE: { label: "비활성 계정", tip: "직원관리에서 계정 상태 확인" },
  RESIGNED: { label: "퇴사 계정", tip: "퇴사 처리된 계정 — 잘못이면 퇴사일 확인" },
  DEVICE_BLOCKED: { label: "미등록 기기", tip: "폰을 바꾼 경우 — 직원관리에서 기기 초기화" },
};

const ACTION_LABEL: Record<string, string> = {
  LEAVE_BALANCE_UPDATE: "연차 수정",
  EMPLOYEE_UPDATE: "직원 정보 수정",
  EMPLOYEE_CREATE: "직원 생성",
  EMPLOYEE_DELETE: "직원 비활성화",
  EMPLOYEE_RESIGN: "퇴사 처리",
  EMPLOYEE_RESTORE: "직원 복구",
  LEAVE_DECISION: "휴가 결재",
  SCHEDULE_DECISION: "근무일정 결재",
  CONTRACT_DELETE: "계약서 삭제",
  DEVICE_REREGISTER: "기기 재등록(앱 재설치)",
  DEVICE_RESET: "기기 초기화",
  HOLIDAY_ADD: "공휴일 등록",
  HOLIDAY_DELETE: "공휴일 삭제",
};

export default function AdminSettingsPage() {
  const [isLoading, setIsLoading] = useState(false);
  const [admins, setAdmins] = useState<AdminRow[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loginFails, setLoginFails] = useState<LoginFailRow[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  const loadSummary = () => {
    setLoadingData(true);
    fetch("/api/admin/summary")
      .then((r) => (r.ok ? r.json() : { admins: [], logs: [] }))
      .then((d) => { setAdmins(d.admins || []); setLogs(d.logs || []); setLoginFails(d.loginFails || []); })
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

  // 서브 관리자 정보 수정 (이름·연락처·입사일·생일·직책·직급·비밀번호 재설정)
  const [editAdmin, setEditAdmin] = useState<AdminRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editHireDate, setEditHireDate] = useState("");
  const [editBirthDate, setEditBirthDate] = useState("");
  const [editPosition, setEditPosition] = useState("");
  const [editJobGroup, setEditJobGroup] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [savingAdmin, setSavingAdmin] = useState(false);

  const openEditAdmin = (a: AdminRow) => {
    setEditName(a.name);
    setEditPhone(a.phone || "");
    // 날짜는 UTC 자정 저장이라 ISO 앞 10자리가 곧 표시할 날짜다
    setEditHireDate(a.hireDate ? a.hireDate.slice(0, 10) : "");
    setEditBirthDate(a.birthDate ? a.birthDate.slice(0, 10) : "");
    setEditPosition(a.position || "");
    setEditJobGroup(a.jobGroup || "");
    setEditPassword("");
    setEditAdmin(a);
  };

  const handleSaveAdmin = async () => {
    if (!editAdmin) return;
    if (!editName.trim()) { toast.error("이름을 입력해주세요."); return; }
    setSavingAdmin(true);
    try {
      const res = await fetch(`/api/employees/${editAdmin.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          phone: editPhone.trim() || null,
          hireDate: editHireDate || null,
          birthDate: editBirthDate || null,
          position: editPosition.trim() || null,
          jobGroup: editJobGroup.trim() || null,
          ...(editPassword.trim() ? { password: editPassword.trim() } : {}), // 비우면 비밀번호 유지
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "수정에 실패했습니다."); return; }
      toast.success(`${editName.trim()} 님 정보를 수정했습니다.${editPassword.trim() ? " (비밀번호 변경됨)" : ""}`);
      setEditAdmin(null);
      loadSummary();
    } finally {
      setSavingAdmin(false);
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
    <div className="max-w-6xl mx-auto">
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
                  <th className="px-4 py-2 font-medium text-center">계약 결재자</th>
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
                    <td className="px-4 py-2 text-center">
                      {/* 전자계약 승인자 검색에 이 관리자를 노출할지 — 클릭 즉시 저장 */}
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-indigo-600 cursor-pointer"
                        checked={a.isContractApprover !== false}
                        title="체크 해제하면 전자계약 승인자 검색에 나오지 않습니다"
                        onChange={async (e) => {
                          const v = e.target.checked;
                          setAdmins(prev => prev.map(x => x.id === a.id ? { ...x, isContractApprover: v } : x));
                          const res = await fetch(`/api/employees/${a.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ isContractApprover: v }),
                          });
                          if (res.ok) {
                            toast.success(`${a.name} — 계약 결재자 ${v ? "노출" : "숨김"} 처리했습니다.`);
                          } else {
                            setAdmins(prev => prev.map(x => x.id === a.id ? { ...x, isContractApprover: !v } : x));
                            toast.error("저장에 실패했습니다.");
                          }
                        }}
                      />
                    </td>
                    <td className="px-4 py-2 text-right">
                      {a.isSuperAdmin ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-blue-600 hover:bg-blue-50 hover:text-blue-700"
                            onClick={() => openEditAdmin(a)}
                          >
                            수정
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => handleResignAdmin(a)}
                          >
                            퇴사 처리
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* 서브 관리자 정보 수정 */}
      <Dialog open={!!editAdmin} onOpenChange={(v) => { if (!v) setEditAdmin(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>서브 관리자 정보 수정</DialogTitle></DialogHeader>
          {editAdmin && (
            <div className="space-y-3">
              <div>
                <Label>이메일</Label>
                <Input value={editAdmin.email} disabled className="bg-gray-50" />
              </div>
              <div>
                <Label>이름</Label>
                <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
              </div>
              <div>
                <Label>연락처</Label>
                <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="010-0000-0000" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>입사일</Label>
                  <Input type="date" value={editHireDate} onChange={(e) => setEditHireDate(e.target.value)} />
                </div>
                <div>
                  <Label>생일 <span className="text-xs text-gray-400">(봇 축하용)</span></Label>
                  <Input type="date" value={editBirthDate} onChange={(e) => setEditBirthDate(e.target.value)} />
                </div>
                <div>
                  <Label>직책</Label>
                  <Input value={editPosition} onChange={(e) => setEditPosition(e.target.value)} placeholder="예: 팀장" />
                </div>
                <div>
                  <Label>직급</Label>
                  <Input value={editJobGroup} onChange={(e) => setEditJobGroup(e.target.value)} placeholder="예: 과장" />
                </div>
              </div>
              <div>
                <Label>새 비밀번호 <span className="text-xs text-gray-400">(비우면 기존 유지 · 8자 이상)</span></Label>
                <Input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="변경 시에만 입력" />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" size="sm" onClick={() => setEditAdmin(null)}>취소</Button>
                <Button size="sm" onClick={handleSaveAdmin} disabled={savingAdmin}>
                  {savingAdmin ? "저장 중…" : "저장"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

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

      {/* 로그인 실패 — "로그인이 안 돼요" 문의의 원인을 여기서 바로 확인 */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>로그인 실패 <span className="text-sm font-normal text-gray-500">· 최근 50건</span></CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loadingData ? (
            <p className="p-4 text-sm text-gray-400">불러오는 중…</p>
          ) : loginFails.length === 0 ? (
            <p className="p-4 text-sm text-gray-400">기록된 로그인 실패가 없습니다.</p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0">
                  <tr className="border-b text-xs text-gray-500 bg-gray-50 text-left">
                    <th className="px-4 py-2 font-medium w-36">시간</th>
                    <th className="px-4 py-2 font-medium">누구</th>
                    <th className="px-4 py-2 font-medium">사유</th>
                    <th className="px-4 py-2 font-medium">기기</th>
                    <th className="px-4 py-2 font-medium">조치</th>
                  </tr>
                </thead>
                <tbody>
                  {loginFails.map((f) => (
                    <tr key={f.id} className="border-b last:border-0 align-top">
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{fmt(f.createdAt)}</td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="text-gray-900">{f.userName || "?"}</span>
                        <span className="block text-xs text-gray-400">{f.email}</span>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap">
                        <span className="text-xs rounded px-2 py-0.5 bg-red-50 text-red-700">{FAIL_REASON[f.reason]?.label || f.reason}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-500 text-xs whitespace-nowrap">{f.deviceName ? `${f.deviceName} (${f.platform || "-"})` : "웹"}</td>
                      <td className="px-4 py-2 text-gray-500 text-xs">{FAIL_REASON[f.reason]?.tip || "-"}</td>
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
