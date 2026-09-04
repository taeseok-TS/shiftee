"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { SharedSidebar } from "./SharedSidebar";

/**
 * 폰(<768px)용 대시보드 메뉴 — 사이드바가 화면 2/3를 차지해 내용이 찌그러지던 문제의 해법.
 * 데스크톱에서는 아무것도 렌더하지 않고, 폰에서는 햄버거 버튼 → 서랍으로 기존 사이드바를 연다.
 */
export function MobileDashboardNav({ role, children }: { role?: string; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // 메뉴에서 다른 화면으로 이동하면 서랍을 자동으로 닫는다
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      <button className="md:hidden p-1 -ml-1 text-gray-600" onClick={() => setOpen(true)} aria-label="메뉴 열기">
        <Menu size={22} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 shadow-xl">
            {/* children 을 주면 그 사이드바를, 안 주면 직원용을 연다.
                관리자.원장 화면도 같은 서랍을 쓰려고 열어 뒀다 (2026-09-04). */}
            {children ?? <SharedSidebar role={role ?? "EMPLOYEE"} />}
          </div>
        </div>
      )}
    </>
  );
}
