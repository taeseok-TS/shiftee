"use client";

// 화면 안 탭(2026-10-20 시안 v2 8번) — 메뉴 하나로 묶인 화면들(예: 결재함 = 휴가·근무일정 · 계약 · 처리한 요청)을 본문 위 탭으로 오간다.
// 탭 목록은 admin-nav 의 tabs. 그 주소들이 아니면 아무것도 그리지 않는다.
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { matchNav } from "./admin-nav";

export function AdminTabs() {
  const pathname = usePathname();
  const search = useSearchParams();
  const { item } = matchNav(pathname);
  if (!item?.tabs?.length) return null;
  // 같은 주소에 쿼리만 다른 탭은 없다 — 주소 경로로 고르고, 쿼리가 있는 탭은 그 값까지 맞을 때 켠다
  const active = (href: string) => {
    const [p, q] = href.split("?");
    if (pathname !== p && !pathname.startsWith(p + "/")) return false;
    if (!q) return true;
    return [...new URLSearchParams(q)].every(([k, v]) => search.get(k) === v);
  };
  const on = item.tabs.filter((t) => active(t.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-gray-200" role="tablist" aria-label={`${item.label} 탭`}>
      {item.tabs.map((t) => (
        <Link key={t.href} href={t.href} role="tab" aria-selected={t === on}
          className={cn("shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
            t === on ? "border-indigo-600 text-indigo-700" : "border-transparent text-gray-500 hover:text-gray-800")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
