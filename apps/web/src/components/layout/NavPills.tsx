"use client";
// 메뉴 정의(admin-nav)의 tabs 를 「제목 아래 알약」 한 줄로 — 화면 안 탭 모양을 하나로(2026-10-28 이예지 디자인 ②).
// PageHead 가 제목 바로 아래에 그린다. PageHead 가 없는 옛 화면은 AdminTabs 가 본문 맨 위에 같은 알약을 그린다.
// tabs 주소에는 쿼리가 없어 경로로만 고른다(useSearchParams 를 쓰면 정적 화면마다 Suspense 가 필요해진다)
import { usePathname } from "next/navigation";
import { PillTabs } from "@/components/kit";
import { matchNav } from "./admin-nav";

export function NavPills() {
  const pathname = usePathname();
  if (!pathname?.startsWith("/admin")) return null;
  const { item } = matchNav(pathname);
  if (!item?.tabs?.length) return null;
  const on = item.tabs
    .filter((t) => { const p = t.href.split("?")[0]; return pathname === p || pathname.startsWith(p + "/"); })
    .sort((a, b) => b.href.length - a.href.length)[0];
  return <PillTabs tabs={item.tabs.map((t) => ({ key: t.href, label: t.label, href: t.href }))} value={on?.href ?? ""} />;
}
