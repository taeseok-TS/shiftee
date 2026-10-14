import Link from "next/link";
import { RegionTabs } from "./RegionTabs";

/**
 * 큐브티워크 「입학정보」 화면 머리(2026-10-14 디렉터 지시) — 맨 위 주제 탭(지금은 「고입 기본계획」 하나), 그 아래 지역 탭(2027 서울·2027 경기).
 * 주제가 늘면 TOPICS 에 한 줄 더한다. 본문은 진학입시EX 에서 뽑은 묶음을 그대로 쓴다(components/admission-guide, 손으로 고치지 않음).
 */
const TOPICS = [
  { key: "high-school", href: "/work/admission/high-school/seoul", label: "고입 기본계획" },
] as const;

export function AdmissionTabs({ topic, region }: { topic: (typeof TOPICS)[number]["key"]; region: "seoul" | "gyeonggi" }) {
  return (
    <div className="mb-2">
      <h1 className="text-xl font-bold text-gray-900 mb-3">입학정보</h1>
      <nav aria-label="주제" className="mb-3 flex items-center gap-1 border-b">
        {TOPICS.map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.key === topic ? "page" : undefined}
            className={t.key === topic
              ? "px-4 py-2 text-sm font-semibold text-indigo-700 border-b-2 border-indigo-600 -mb-px"
              : "px-4 py-2 text-sm text-gray-500 hover:text-gray-800"}>
            {t.label}
          </Link>
        ))}
      </nav>
      <RegionTabs active={region} />
    </div>
  );
}
