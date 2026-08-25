"use client";

// 비밀번호 재설정 요청 — 이메일로 재설정 링크를 받는다 (관리자 개입 없는 셀프 재설정)
import { useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "요청에 실패했습니다."); return; }
      setSent(true);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>비밀번호 재설정</CardTitle>
          <CardDescription>가입된 이메일로 재설정 링크를 보내드립니다.</CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-sm">
              <p className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-3">
                재설정 메일을 보냈습니다. 메일함(스팸함 포함)에서 <b>[큐브티] 비밀번호 재설정 안내</b>를 열어
                1시간 안에 새 비밀번호를 설정해주세요.
              </p>
              <Link href="/login" className="text-indigo-600 hover:underline">로그인 화면으로 돌아가기</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">이메일 (로그인 아이디)</Label>
                <Input id="email" type="email" placeholder="가입된 이메일을 입력하세요"
                  value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded p-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "발송 중..." : "재설정 링크 받기"}
              </Button>
              <p className="text-xs text-gray-500">
                이메일이 등록되어 있지 않거나 기억나지 않으면 <b>관리자에게 문의해 주세요.</b>
              </p>
              <p className="text-center text-sm">
                <Link href="/login" className="text-gray-500 hover:underline">로그인으로 돌아가기</Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
