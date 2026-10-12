// 계약서 양식(템플릿) 분류 — 5묶음(2026-10-12 개선 제안 #214-5, 디렉터 채택). 순수 모듈(화면 공용).
// 양식 이름으로 가른다(양식에 별도 분류 칸을 두지 않는다 — 이름 규칙이 이미 안정적이고, 새 양식도 이름만 맞추면 자동 분류).
//  근로계약서: 근로계약서·코디·기타직무 / 입사 서류: 비밀유지서약서·개인정보동의서(퇴직시 제외)
//  휴가·근태 신청서: 출산휴가원·임신기 단축·근로시간 변경·유급휴가 선사용·무급휴가 등 / 퇴사 서류: 사직원·금품청산·퇴직금·연차수당·비밀유지(퇴직시) / 기타
export const TEMPLATE_CATEGORIES = ["근로계약서", "입사 서류", "휴가·근태 신청서", "퇴사 서류", "기타"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];

export function templateCategoryOf(name: string): TemplateCategory {
  const n = name.replace(/\s+/g, "");
  if (/퇴직시|사직원|금품청산|퇴직금|연차수당|퇴직/.test(n)) return "퇴사 서류";
  if (/근로계약서|근로계약|코디|기타직무|파트타임/.test(n)) return "근로계약서";
  if (/비밀유지|개인정보/.test(n)) return "입사 서류";
  if (/휴가|휴직|임신|단축|근로시간|근무시간|출산|육아|가족돌봄|선사용|무급|신청서|동의서/.test(n)) return "휴가·근태 신청서";
  return "기타";
}
