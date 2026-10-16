// 묶음(패키지) 발송에 쓰이는 양식 찾기 — 「계약서 보내기」 화면(/admin/contracts/send, 2026-10-17)이 묶음 카드에 **구성 문서 이름을 보여 주려고** 쓴다. 순수 모듈.
//
// ⚠ 실제 묶음 구성·작성·발송은 지금도 「보낸 계약서」 화면(app/admin/contracts/page.tsx)의 작성 창이 정한다(이 화면은 ?compose=hire|resign 으로 그 창을 열 뿐).
//   아래 규칙은 그 화면의 pkgTemplates·privacyTemplate·empTemplate·resignTemplates 정의와 **글자 하나까지 같게** 옮겨 둔 것 —
//   작성 창의 규칙을 바꾸면 여기도 같이 바꾼다(다르면 카드에 보이는 이름과 실제로 나가는 문서가 달라진다).
export type PkgTemplate = { id: string; name: string; type: string; createdAt?: string };

// 퇴사 패키지 문서 5종과 기본 체크(#203, 이예지 답 2026-10-14: 사직원·비밀유지서약서 기본, 나머지는 필요할 때) — 작성 창과 같은 값
export const RESIGN_DOC_LABELS = ["사직원", "금품청산 지급기일연장 동의서", "퇴직금 정산 신청서", "연차수당 정산 신청서", "비밀유지서약서(퇴직시)"];
export const RESIGN_PICK_DEFAULT = [true, false, false, false, true];

export function findPackageTemplates<T extends PkgTemplate>(templates: T[]) {
  // 사본 빼고 등록 순서(최근 먼저)로만 — 「맨 위 고정」·「사본 만들기」(#78)가 발송 문서를 몰래 바꾸지 않게
  const pkg = templates
    .filter((t) => !/\(사본( \d+)?\)/.test(t.name))
    .sort((x, y) => (y.createdAt || "").localeCompare(x.createdAt || ""));
  const privacyTemplate = pkg.find((t) => t.name.includes("개인정보") && !t.name.includes("[채용]"));
  const empTemplate = pkg.find((t) => t.name.includes("에듀플렉스") && t.name.includes("근로계약"))
    || pkg.find((t) => t.name.includes("근로계약") && !t.name.includes("코디") && !t.name.includes("기타직무"))
    || pkg.find((t) => t.type === "EMPLOYMENT" && !t.name.includes("코디") && !t.name.includes("기타직무"));
  const resignTemplates = [
    pkg.find((t) => t.name.includes("사직원")),
    pkg.find((t) => t.name.includes("금품청산")),
    pkg.find((t) => t.name.includes("퇴직금 정산")),
    pkg.find((t) => t.name.includes("연차수당")),
    pkg.find((t) => t.name.includes("비밀유지") && t.name.includes("퇴직")),
  ];
  return {
    empTemplate, privacyTemplate, resignTemplates,
    canBundle: !!privacyTemplate && !!empTemplate,        // 신규입사 패키지 2종(#202) — 비밀유지서약서는 안 들어간다
    canResignBundle: resignTemplates.every(Boolean),
  };
}
