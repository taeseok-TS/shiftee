"use client";

// 화면 안 탭(2026-10-20 시안 v2 8번) — 메뉴 하나로 묶인 화면들(예: 결재함 = 휴가·근무일정 · 계약 · 처리한 요청)을 본문 위 탭으로 오간다.
// 탭 목록은 admin-nav 의 tabs. 그 주소들이 아니면 아무것도 그리지 않는다.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { matchNav } from "./admin-nav";

// 제목 아래에 알약(NavPills)을 직접 그리는 화면 — 여기서는 그리지 않는다(두 번 나오지 않게, 2026-10-28 이예지 디자인 ②)
const SELF_PILLS = new Set(["/admin/schedule", "/admin/schedule-templates", "/admin/contract-templates"]);

export function AdminTabs() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { item } = matchNav(pathname);
  if (!item?.tabs?.length || SELF_PILLS.has(pathname)) return null;
  // 같은 주소에 쿼리만 다른 탭은 없다 — 주소 경로로 고르고, 쿼리가 있는 탭은 그 값까지 맞을 때 켠다
  const active = (href: string) => {
    const [p, q] = href.split("?");
    if (pathname !== p && !pathname.startsWith(p + "/")) return false;
    if (!q) return true;
    return [...new URLSearchParams(q)].every(([k, v]) => search.get(k) === v);
  };
  const on = item.tabs.filter((t) => active(t.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    // 밑줄 탭 대신 다른 화면과 같은 알약 모양(kit PillTabs 와 같은 값 — 이예지 디자인 ②)
    <div className="mb-[18px] flex flex-wrap gap-2" role="tablist" aria-label={`${item.label} 탭`}>
      {item.tabs.map((t) => (
        <Link key={t.href} href={t.href} role="tab" aria-selected={t === on}
          className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-4 py-[7px] text-[14px] font-semibold transition-colors",
            t === on ? "border-[#4f46e5] bg-[#4f46e5] text-white" : "border-[#e2e8f0] bg-white text-[#475569] hover:bg-[#f8fafc]")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
