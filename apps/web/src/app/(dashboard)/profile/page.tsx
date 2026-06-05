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
  role: string;
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

  // 비밀번호 폼 상태
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // 비밀번호 강도
  const passwordStrength = evaluatePasswordStrength(newPassword);

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
      } catch (error) {
        console.error("프로필 조회 에러:", error);
        toast.error("프로필을 불러올 수 없습니다.");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

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
