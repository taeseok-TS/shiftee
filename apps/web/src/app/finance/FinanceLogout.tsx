"use client";

import { Button } from "@/components/ui/button";

export function FinanceLogout() {
  return (
    <Button size="sm" variant="outline" onClick={async () => {
      await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
      window.location.href = "/login";
    }}>로그아웃</Button>
  );
}
