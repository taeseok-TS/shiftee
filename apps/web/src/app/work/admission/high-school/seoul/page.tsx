import { SeoulGuide } from "./guide-client";
import { AdmissionTabs } from "@/components/admission-guide/AdmissionTabs";

// 큐브티워크 입학정보 › 고입 기본계획 › 2027 서울 (진학입시EX 묶음 2026-10-07, 디렉터 지시 2026-10-14). 로그인 확인은 app/work/layout.tsx
export const metadata = { title: "2027학년도 서울특별시 고등학교 입학전형 기본계획" };

export default function Page() {
  return (
    <div className="p-4 md:p-6 [--work-head:3rem] md:[--work-head:0px]">
      <AdmissionTabs topic="high-school" region="seoul" />
      <SeoulGuide />
    </div>
  );
}
