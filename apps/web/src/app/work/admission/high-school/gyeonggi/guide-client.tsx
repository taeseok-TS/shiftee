"use client";

import { AdmissionGuide } from "@/components/admission-guide/AdmissionGuide";
import { GYEONGGI_ADMISSION_BODY } from "@/components/admission-guide/gyeonggi-body";
import { run } from "@/components/admission-guide/gyeonggi-logic";

// 원문 PDF 는 public/admission-guide/local/*.pdf(묶음의 pdfs/).
// stickyTop: 큐브티워크는 창이 스크롤한다(work 레이아웃이 높이를 제한하지 않음) — 폰(<md)은 상단 바 3rem 아래, PC 는 앱 머리가 없어 0px.
// 값은 page.tsx 바깥 상자의 CSS 변수 --work-head 로 받는다(묶음 파일은 손대지 않음, 10/14 검증 지적)
export function GyeonggiGuide() {
  return <AdmissionGuide body={GYEONGGI_ADMISSION_BODY} run={run} assetBase="/admission-guide" stickyTop="var(--work-head, 0px)" />;
}
