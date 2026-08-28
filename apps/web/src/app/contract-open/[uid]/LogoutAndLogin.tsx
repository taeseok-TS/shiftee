"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

// 로그아웃 후 로그인 화면으로 — 이메일 링크 본인 확인 관문에서 계정 전환용 (#140)
export default function LogoutAndLogin() {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      className="w-full"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } catch {
          /* 실패해도 로그인 화면으로 이동 — 거기서 다시 로그인하면 세션이 교체된다 */
        }
        window.location.href = "/login";
      }}
    >
      {busy ? "로그아웃 중..." : "로그아웃하고 본인 계정으로 로그인"}
    </Button>
  );
}
