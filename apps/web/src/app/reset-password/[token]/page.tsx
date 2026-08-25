"use client";

// 비밀번호 재설정 — 이메일 링크의 토큰으로 새 비밀번호 설정 (1시간·1회용)
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [name, setName] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || !d.valid) { setError(d.error || "링크를 확인할 수 없습니다."); setState("invalid"); return; }
        setName(d.name || ""); setState("ready");
      })
      .catch(() => { setError("네트워크 오류가 발생했습니다."); setState("invalid"); });
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw !== pw2) { setError("비밀번호가 서로 다릅니다."); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: pw }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error || "변경에 실패했습니다."); return; }
      setState("done");
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally { setLoading(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>새 비밀번호 설정</CardTitle>
          {state === "ready" && <CardDescription>{name} 님의 새 비밀번호를 입력하세요.</CardDescription>}
        </CardHeader>
        <CardContent>
          {state === "checking" && <p className="text-sm text-gray-500">링크 확인 중...</p>}
          {state === "invalid" && (
            <div className="space-y-4 text-sm">
              <p className="bg-red-50 border border-red-100 text-red-700 rounded-lg p-3">{error}</p>
              <Link href="/forgot-password" className="text-indigo-600 hover:underline">재설정 링크 다시 받기</Link>
            </div>
          )}
          {state === "done" && (
            <div className="space-y-4 text-sm">
              <p className="bg-green-50 border border-green-200 text-green-800 rounded-lg p-3">
                비밀번호가 변경되었습니다. 새 비밀번호로 로그인해주세요.
              </p>
              <Link href="/login"><Button className="w-full">로그인하러 가기</Button></Link>
            </div>
          )}
          {state === "ready" && (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="pw">새 비밀번호</Label>
                <Input id="pw" type="password" value={pw} onChange={(e) => setPw(e.target.value)} required autoFocus />
                <p className="text-xs text-gray-500">8자 이상, 대문자·숫자·특수문자를 포함해야 합니다.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pw2">새 비밀번호 확인</Label>
                <Input id="pw2" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
              </div>
              {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded p-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "변경 중..." : "비밀번호 변경"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
