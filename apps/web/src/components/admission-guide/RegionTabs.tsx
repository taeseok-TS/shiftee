import Link from "next/link";

/** 지역 탭(2027 서울 · 2027 경기) — 큐브티워크 「입학정보 › 고입 기본계획」 경로(2026-10-14 디렉터 지시) */
const REGIONS = [
  { key: "seoul", href: "/work/admission/high-school/seoul", label: "2027 서울", note: "서울시교육청 원문" },
  { key: "gyeonggi", href: "/work/admission/high-school/gyeonggi", label: "2027 경기", note: "경기도교육청 원문" },
] as const;

export function RegionTabs({ active }: { active: (typeof REGIONS)[number]["key"] }) {
  return (
    <nav aria-label="지역" className="mb-4 flex items-center gap-2 overflow-x-auto whitespace-nowrap">
      <span className="mr-1 text-sm font-semibold text-gray-500">2027학년도 고입 기본계획</span>
      {REGIONS.map((r) => (
        <Link
          key={r.key}
          href={r.href}
          aria-current={r.key === active ? "page" : undefined}
          className={
            r.key === active
              ? "shrink-0 rounded-full border border-[#1a2332] bg-[#1a2332] px-4 py-1.5 text-sm font-semibold text-white"
              : "shrink-0 rounded-full border bg-white px-4 py-1.5 text-sm hover:bg-gray-50"
          }
        >
          {r.label}
          <span className={r.key === active ? "ml-1.5 hidden text-[12px] font-normal text-white/70 sm:inline" : "ml-1.5 hidden text-[12px] text-gray-400 sm:inline"}>{r.note}</span>
        </Link>
      ))}
    </nav>
  );
}
