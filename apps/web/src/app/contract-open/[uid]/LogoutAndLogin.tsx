"use client";

import { resetUserPrefs } from "@/components/prefs/useUserPrefs";
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
          resetUserPrefs();   // 내 화면 설정 저장소 비움 — 같은 브라우저의 다음 사람에게 넘어가지 않게(#73)
        } catch {
          /* 실패해도 로그인 화면으로 이동 — 거기서 다시 로그인하면 세션이 교체된다 */
        }
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;   // 본인 계정으로 로그인하면 이 링크로 돌아온다
      }}
    >
      {busy ? "로그아웃 중..." : "로그아웃하고 본인 계정으로 로그인"}
    </Button>
  );
}
