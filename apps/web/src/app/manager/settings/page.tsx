"use client";

import { PageHead } from "@/components/kit";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

export default function ManagerSettingsPage() {
  const [isLoading, setIsLoading] = useState(false);

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
      <PageHead crumb="설정 › 환경설정" title="환경설정" note="원장 설정" />

      <Card>
        <CardHeader>
          <CardTitle>지점 관리 설정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium text-gray-900">결재 알림</p>
              <p className="text-sm text-gray-600">결재 요청이 올 때 알림을 받습니다.</p>
            </div>
            <input type="checkbox" defaultChecked className="w-5 h-5" />
          </div>
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium text-gray-900">지점 직원 변동 알림</p>
              <p className="text-sm text-gray-600">지점 직원 추가/삭제 시 알림을 받습니다.</p>
            </div>
            <input type="checkbox" defaultChecked className="w-5 h-5" />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>알림 설정</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div>
              <p className="font-medium text-gray-900">이메일 알림</p>
              <p className="text-sm text-gray-600">중요한 알림을 이메일로 받습니다.</p>
            </div>
            <input type="checkbox" defaultChecked className="w-5 h-5" />
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
