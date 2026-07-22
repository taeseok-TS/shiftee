"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface User {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  department: string | null;
  jobGroup: string | null;
  position: string | null;
  branch: string | null;
  hireDate: string | null;
  address: string | null;
  birthDate: string | null;
  role: string;
  avatarUrl?: string | null;
}

/**
 * 비밀번호 강도 평가
 */
function evaluatePasswordStrength(password: string): { strength: number; messages: string[] } {
  const messages: string[] = [];
  let strength = 0;

  if (!password) {
    return { strength: 0, messages };
  }

  // 길이
  if (password.length >= 8) {
    strength += 25;
  } else {
    messages.push("최소 8자 이상");
  }

  // 대문자
  if (/[A-Z]/.test(password)) {
    strength += 25;
  } else {
    messages.push("대문자 포함");
  }

  // 숫자
  if (/[0-9]/.test(password)) {
    strength += 25;
  } else {
    messages.push("숫자 포함");
  }

  // 특수문자
  if (/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    strength += 25;
  } else {
    messages.push("특수문자 포함");
  }

  return { strength, messages };
}

export default function ProfilePage() {
  const [tabValue, setTabValue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [addressEdit, setAddressEdit] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);

  // 비밀번호 폼 상태
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // 비밀번호 강도
  const passwordStrength = evaluatePasswordStrength(newPassword);

  async function saveAddress() {
    setSavingAddress(true);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addressEdit }),
      });
      if (!res.ok) { toast.error("주소 저장에 실패했습니다."); return; }
      setUser((u) => (u ? { ...u, address: addressEdit } : u));
      toast.success("주소가 저장되었습니다.");
    } finally { setSavingAddress(false); }
  }

  // 프로필 조회
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch("/api/profile");
        if (!res.ok) {
          throw new Error("프로필 조회 실패");
        }
        const data = await res.json();
        setUser(data.user);
        setAddressEdit(data.user?.address || "");
      } catch (error) {
        console.error("프로필 조회 에러:", error);
        toast.error("프로필을 불러올 수 없습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  // 결재 결과 알림 설정
  const [notifyApproval, setNotifyApproval] = useState(true);
  const [notifyForced, setNotifyForced] = useState(false);
  useEffect(() => {
    fetch("/api/me/notify").then(r => r.ok ? r.json() : null).then(d => {
      if (d) { setNotifyApproval(d.notifyApproval); setNotifyForced(d.forced); }
    }).catch(() => {});
  }, []);
  const toggleNotify = async (on: boolean) => {
    setNotifyApproval(on);
    const res = await fetch("/api/me/notify", {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notifyApproval: on }),
    });
    if (!res.ok) { setNotifyApproval(!on); toast.error("설정 저장 실패"); }
    else toast.success(on ? "결재 결과 알림을 받습니다." : "결재 결과 알림을 껐습니다.");
  };

  // 프로필 사진 업로드/삭제
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/me/avatar", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok) { toast.error(d.error || "업로드에 실패했습니다."); return; }
      setUser((u) => (u ? { ...u, avatarUrl: d.avatarUrl } : u));
      toast.success("프로필 사진이 변경되었습니다.");
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  };
  const handleAvatarRemove = async () => {
    const res = await fetch("/api/me/avatar", { method: "DELETE" });
    if (res.ok) { setUser((u) => (u ? { ...u, avatarUrl: null } : u)); toast.success("프로필 사진을 삭제했습니다."); }
  };

  // 비밀번호 변경
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      // 유효성 검사
      if (!currentPassword) {
        toast.error("현재 비밀번호를 입력해주세요.");
        return;
      }

      if (!newPassword) {
        toast.error("새 비밀번호를 입력해주세요.");
        return;
      }

      if (!confirmPassword) {
        toast.error("비밀번호 확인을 입력해주세요.");
        return;
      }

      if (newPassword !== confirmPassword) {
        toast.error("새 비밀번호가 일치하지 않습니다.");
        return;
      }

      if (passwordStrength.strength < 100) {
        toast.error(
          `비밀번호는 다음을 포함해야 합니다: ${passwordStrength.messages.join(", ")}`
        );
        return;
      }

      const res = await fetch("/api/profile/password", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          confirmPassword,
        }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "비밀번호 변경 실패");
      }

      // 폼 초기화
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      toast.success("비밀번호가 변경되었습니다.");
    } catch (error) {
      console.error("비밀번호 변경 에러:", error);
      toast.error(error instanceof Error ? error.message : "비밀번호 변경에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-md mx-auto py-8 flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="max-w-md mx-auto py-8">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-900">
          프로필을 불러올 수 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">환경설정</h1>
        <p className="text-sm text-gray-500 mt-1">개인 정보와 보안 설정을 관리합니다</p>
      </div>

      <Card>
        {/* 탭 헤더 */}
        <div className="flex border-b border-gray-200">
          <button
            onClick={() => setTabValue(0)}
            className={`flex-1 py-3 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
              tabValue === 0
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            기본 정보
          </button>
          <button
            onClick={() => setTabValue(1)}
            className={`flex-1 py-3 px-4 text-sm font-medium text-center border-b-2 transition-colors ${
              tabValue === 1
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            보안
          </button>
        </div>

        <CardContent className="pt-6">
          {/* 탭 1: 기본 정보 (읽기 전용) */}
          {tabValue === 0 && (
            <div className="space-y-4">
              {/* 프로필 사진 */}
              <div className="flex flex-col items-center gap-3 pb-2">
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatarUrl} alt={user.name} className="w-24 h-24 rounded-full object-cover border" />
                ) : (
                  <div className="w-24 h-24 rounded-full flex items-center justify-center text-white text-3xl font-bold bg-blue-500">
                    {user.name?.trim().charAt(0) || "?"}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <label className="cursor-pointer">
                    <span className={`inline-block text-sm px-3 py-1.5 rounded-md border ${uploadingAvatar ? "opacity-50" : "hover:bg-gray-50"}`}>
                      {uploadingAvatar ? "업로드 중…" : "사진 변경"}
                    </span>
                    <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} disabled={uploadingAvatar} />
                  </label>
                  {user.avatarUrl && (
                    <button type="button" onClick={handleAvatarRemove} className="text-sm px-3 py-1.5 rounded-md border text-red-500 hover:bg-red-50">삭제</button>
                  )}
                </div>
              </div>
              {/* 이메일 */}
              <div className="space-y-1.5">
                <Label className="text-gray-700">이메일</Label>
                <Input
                  type="email"
                  value={user.email}
                  disabled
                  className="bg-gray-50"
                />
              </div>

              {/* 이름 */}
              <div className="space-y-1.5">
                <Label className="text-gray-700">이름</Label>
                <Input
                  value={user.name}
                  disabled
                  className="bg-gray-50"
                />
              </div>

              {/* 직급과 직군 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-gray-700">직급</Label>
                  <Input
                    value={user.position || ""}
                    disabled
                    className="bg-gray-50"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-700">직군</Label>
                  <Input
                    value={user.jobGroup || ""}
                    disabled
                    className="bg-gray-50"
                  />
                </div>
              </div>

              {/* 부서와 지점 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-gray-700">부서</Label>
                  <Input
                    value={user.department || ""}
                    disabled
                    className="bg-gray-50"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-700">지점</Label>
                  <Input
                    value={user.branch || ""}
                    disabled
                    className="bg-gray-50"
                  />
                </div>
              </div>

              {/* 입사일 */}
              <div className="space-y-1.5">
                <Label className="text-gray-700">입사일</Label>
                <Input
                  value={
                    user.hireDate
                      ? new Date(user.hireDate).toLocaleDateString("ko-KR", {
                          year: "numeric",
                          month: "2-digit",
                          day: "2-digit",
                        })
                      : ""
                  }
                  disabled
                  className="bg-gray-50"
                />
              </div>

              {/* 주소 (편집 가능) — 전자계약서에 자동으로 채워집니다 */}
              <div className="space-y-1.5">
                <Label className="text-gray-700">주소 <span className="text-xs text-gray-400 font-normal">(전자계약서에 자동 반영)</span></Label>
                <div className="flex gap-2">
                  <Input
                    value={addressEdit}
                    onChange={(e) => setAddressEdit(e.target.value)}
                    placeholder="예: 서울시 강남구 테헤란로 123"
                  />
                  <Button variant="outline" disabled={savingAddress || addressEdit === (user.address || "")}
                    onClick={saveAddress}>{savingAddress ? "저장 중..." : "저장"}</Button>
                </div>
              </div>

              {/* 결재 결과 알림 설정 */}
              <div className="flex items-center justify-between rounded-lg border p-3 mt-4">
                <div>
                  <p className="text-sm font-medium text-gray-700">결재 결과 알림</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {notifyForced
                      ? "관리자 정책으로 항상 발송됩니다"
                      : "휴가·근무일정 결재 승인/반려 시 큐브티 봇 알림을 받습니다"}
                  </p>
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input type="checkbox" className="sr-only peer" checked={notifyForced ? true : notifyApproval}
                    disabled={notifyForced} onChange={(e) => toggleNotify(e.target.checked)} />
                  <div className="w-10 h-5.5 h-6 bg-gray-200 peer-checked:bg-blue-600 rounded-full relative transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-4 peer-disabled:opacity-60" />
                </label>
              </div>

              {/* 정보 메시지 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mt-4">
                <p className="text-sm text-blue-900">
                  개인 정보는 관리자를 통해 변경할 수 있습니다.
                </p>
              </div>
            </div>
          )}

          {/* 탭 2: 보안 (비밀번호 변경) */}
          {tabValue === 1 && (
            <form onSubmit={handleChangePassword} className="space-y-4">
              {/* 현재 비밀번호 */}
              <div className="space-y-1.5">
                <Label htmlFor="current-password" className="text-gray-700">
                  현재 비밀번호 *
                </Label>
                <Input
                  id="current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="현재 비밀번호 입력"
                  required
                />
              </div>

              {/* 새 비밀번호 */}
              <div className="space-y-1.5">
                <Label htmlFor="new-password" className="text-gray-700">
                  새 비밀번호 *
                </Label>
                <Input
                  id="new-password"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="새 비밀번호 입력"
                  required
                />
                <p className="text-xs text-gray-500">
                  최소 8자, 대문자, 숫자, 특수문자 포함 필수
                </p>
              </div>

              {/* 비밀번호 강도 표시 */}
              {newPassword && (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <p className="text-xs text-gray-600">비밀번호 강도</p>
                    <span
                      className={`text-xs font-medium ${
                        passwordStrength.strength === 100
                          ? "text-green-600"
                          : passwordStrength.strength >= 75
                            ? "text-yellow-600"
                            : "text-red-600"
                      }`}
                    >
                      {passwordStrength.strength === 100
                        ? "강함"
                        : passwordStrength.strength >= 75
                          ? "중간"
                          : "약함"}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        passwordStrength.strength === 100
                          ? "bg-green-500"
                          : passwordStrength.strength >= 75
                            ? "bg-yellow-500"
                            : "bg-red-500"
                      }`}
                      style={{ width: `${passwordStrength.strength}%` }}
                    />
                  </div>
                  {passwordStrength.messages.length > 0 && (
                    <p className="text-xs text-gray-600">
                      필요: {passwordStrength.messages.join(", ")}
                    </p>
                  )}
                </div>
              )}

              {/* 비밀번호 확인 */}
              <div className="space-y-1.5">
                <Label htmlFor="confirm-password" className="text-gray-700">
                  비밀번호 확인 *
                </Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="새 비밀번호 다시 입력"
                  required
                  className={
                    confirmPassword.length > 0 && newPassword !== confirmPassword
                      ? "border-red-500"
                      : ""
                  }
                />
                {confirmPassword.length > 0 && newPassword !== confirmPassword && (
                  <p className="text-xs text-red-600">비밀번호가 일치하지 않습니다.</p>
                )}
              </div>

              {/* 버튼 */}
              <div className="flex gap-2 justify-end pt-4">
                <Button
                  type="submit"
                  disabled={saving || passwordStrength.strength < 100}
                  className="w-full"
                >
                  {saving ? "변경 중..." : "비밀번호 변경"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
