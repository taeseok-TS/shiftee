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

  // ── 서랍이 열려 있는 동안만 붙이는 처리들 (2026-09-04 감사에서 전부 빠져 있던 것) ──
  useEffect(() => {
    if (!open) return;

    // ① 화면을 넓히면(회전.창 조절) 닫는다. `md:hidden` 은 CSS 일 뿐이라 open 이 남아,
    //    넓혔다 다시 좁히면 누르지도 않은 서랍이 튀어나온다. 데스크톱 폭에서 서랍이
    //    떠 있으면 사이드바가 **두 번 마운트**돼 폴링.리스너도 두 벌이 된다.
    const onResize = () => { if (window.innerWidth >= 768) setOpen(false); };
    // resize 만으로는 부족하다 — 브라우저가 이벤트를 몰아 보내거나(스로틀) 확대.회전에서
    // 안 쏘는 경우가 있다. 중단점을 직접 지켜본다(md = 768px).
    const mq = window.matchMedia("(min-width: 768px)");
    const onBreakpoint = (e: MediaQueryListEvent) => { if (e.matches) setOpen(false); };
    if (mq.matches) setOpen(false);
    mq.addEventListener("change", onBreakpoint);
    // ② ESC 로 닫는다. 오버레이가 div 라 닫기 버튼이 없어 키보드로는 빠져나갈 길이 없었다.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    // ③ 뒤로가기로 닫기는 **일부러 뺐다** (2026-09-04 검증관 B).
    //    pushState 로 가짜 항목을 넣는 방식은 링크로 이동할 때 그 항목을 못 걷어낸다 —
    //    Next 라우터가 이동하며 history.state 를 새 객체로 갈아치워 qtDrawer 표식이
    //    사라지기 때문(실측 확인). 그 결과 "눌러도 아무 일 없는 뒤로가기"가 이동할 때마다
    //    한 개씩 쌓였다. 표식 대신 자체 플래그를 써도 이번엔 링크 이동 직후 history.back()
    //    이 돌아 **전 화면으로 튕긴다**. 닫기는 배경 탭.ESC.링크 탭으로 충분하다.

    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey, true);
    // ④ 뒤 배경이 같이 스크롤되던 것을 막는다
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("resize", onResize);
      mq.removeEventListener("change", onBreakpoint);
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button className="md:hidden p-1 -ml-1 text-gray-600" onClick={() => setOpen(true)} aria-label="메뉴 열기">
        <Menu size={22} />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          {/* 높이는 100dvh 기준 — 100vh 는 폰 주소창.하단바에 가려 마지막 항목(로그아웃)이 안 눌린다 */}
          {/* 링크를 누르면 닫는다. pathname 이 바뀔 때만 닫으면 **지금 보고 있는 메뉴**를
              눌렀을 때 서랍이 화면을 덮은 채 남는다 (2026-09-04 검증관 B). 사이드바 종류가
              여럿이라 개별 Link 대신 위임으로 받는다. */}
          <div className="absolute inset-y-0 left-0 shadow-xl h-[100dvh] overflow-y-auto"
               onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>
            {/* children 을 주면 그 사이드바를, 안 주면 직원용을 연다.
                관리자.원장 화면도 같은 서랍을 쓰려고 열어 뒀다 (2026-09-04). */}
            {children ?? <SharedSidebar role={role ?? "EMPLOYEE"} />}
          </div>
        </div>
      )}
    </>
  );
}
