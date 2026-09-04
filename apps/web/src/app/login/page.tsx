"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "로그인에 실패했습니다.");
      } else {
        // 세션 만료로 튕겨 온 경우 보던 화면으로 되돌린다.
        // ⚠ 문자열 검사(`/` 로 시작하고 `//` 아님)로는 못 막는다. 브라우저는 `\` 를 `/` 와
        //   같게 읽어 `/\evil.com` 이 **https://evil.com 으로 나갔다**(2026-09-04 검증관 B·C
        //   실측). 진짜 도메인에서 정상 로그인시킨 뒤 튕기는 피싱이 된다.
        //   문자 패턴이 아니라 **브라우저와 같은 방식으로 해석해** 출처를 대조한다.
        const raw = new URLSearchParams(window.location.search).get("next") || "";
        let back = "";
        try {
          const u = new URL(raw, window.location.origin);
          if (u.origin === window.location.origin) back = u.pathname + u.search + u.hash;
        } catch { /* 해석이 안 되는 값이면 기본 화면으로 */ }
        router.push(back || "/dashboard");
        router.refresh();
      }
    } catch {
      setError("서버 연결에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-2">
          <div className="flex justify-center mb-2">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-xl">C</span>
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">큐브티</CardTitle>
          <CardDescription>HR 관리 시스템에 로그인하세요</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">이메일</Label>
              <Input
                id="email"
                type="email"
                placeholder="example@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">비밀번호</Label>
              <Input
                id="password"
                type="password"
                placeholder="비밀번호를 입력하세요"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-md">{error}</p>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "로그인 중..." : "로그인"}
            </Button>
            {/* 셀프 비밀번호 재설정 — 관리자 초기화 없이 이메일로 (2026-08-25) */}
            <p className="text-center text-sm">
              <a href="/forgot-password" className="text-gray-500 hover:text-indigo-600 hover:underline">비밀번호를 잊으셨나요?</a>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
