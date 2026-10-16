// 계약서 양식의 「용도」 — 「계약서 보내기」 화면(/admin/contracts/send, 2026-10-17 본부 박정인 님 시안)이 쓰는 분류. 순수 모듈(화면·서버 공용).
//
// 양식 분류 5묶음(lib/template-category — 문서 종류 기준)과 다르다: 이것은 **언제 보내는 서류인가** 기준이고, 한 양식이 여러 용도에 들 수 있다
// (에듀플렉스 근로계약서 = 입사 + 재계약·연봉).
//  · 기본값은 양식 이름·종류로 정한다(defaultPurposesOf). 본부가 양식 관리(템플릿 수정 창)에서 고치면 그 값이 이긴다.
//  · 고친 값은 AppSetting 한 키(contractTemplatePurposes)에 {양식 id: 용도[]} 로 둔다 — 스키마 변경 없음(lib/notify-targets 관례).
//    빈 배열 = 본부가 「용도 없음(기타)」으로 정한 것. 맵에 없는 양식 = 기본값.
//  · 어느 용도에도 안 드는 양식은 화면에서 「기타」 카드로 모은다 — 새 양식이 화면에서 사라지지 않게
export const CONTRACT_PURPOSES = [
  { key: "hire", label: "입사", hint: "첫 출근 전·당일" },
  { key: "renew", label: "재계약·연봉", hint: "3·6·9·12월 갱신" },
  { key: "resign", label: "퇴사", hint: "사직 의사 확인 후" },
  { key: "leave", label: "휴가·근태 신청", hint: "직원이 쓰는 신청서" },
  { key: "recruit", label: "채용", hint: "입사 전 지원자" },
] as const;
export type ContractPurpose = (typeof CONTRACT_PURPOSES)[number]["key"];
export const OTHER_PURPOSE = { key: "other", label: "기타", hint: "용도를 정하지 않은 양식" } as const;
export const PURPOSE_SETTING_KEY = "contractTemplatePurposes";

const PURPOSE_KEYS = CONTRACT_PURPOSES.map((p) => p.key) as string[];
const isPurpose = (v: unknown): v is ContractPurpose => typeof v === "string" && PURPOSE_KEYS.includes(v);
export const purposeLabel = (k: string) => CONTRACT_PURPOSES.find((p) => p.key === k)?.label ?? OTHER_PURPOSE.label;

/** 양식 이름·종류로 정하는 기본 용도. 못 정하면 [](= 기타) */
export function defaultPurposesOf(t: { name: string; type?: string | null }): ContractPurpose[] {
  const n = (t.name || "").replace(/\s+/g, "");
  if (/\[채용\]/.test(n)) return ["recruit"];   // 입사 전 지원자용(2026-10-13 추가 8종) — 이름 머리표가 이미 규칙이다
  // 이름 키워드를 먼저 본다 — 양식 종류(type)는 등록할 때 기본값 EMPLOYMENT 로 남은 신청서(육아휴직원 등)가 많아 마지막에만 쓴다(검증 1).
  // 퇴사는 좁게: 「퇴직연금」 같은 말이 퇴사로 가지 않게 사직·퇴직시·퇴직금·금품청산·연차수당·퇴사만
  if (/사직원|사직서|퇴직시|퇴직금|금품청산|연차수당|퇴사/.test(n)) return ["resign"];
  if (/휴가|휴직|임신|단축|근로시간변경|근무시간변경|출산|육아|가족돌봄|선사용|무급|신청서/.test(n)) return ["leave"];
  if (/근로계약|코디|기타직무|파트타임/.test(n)) {
    // 코디·기타직무(외부) 계약서는 채용할 때 쓰는 것 — 재계약 카드에는 기본으로 넣지 않는다(본부가 넣을 수 있다)
    return /코디|기타직무/.test(n) ? ["hire"] : ["hire", "renew"];
  }
  if (/연봉|재계약|갱신/.test(n)) return ["renew"];
  if (/비밀유지|개인정보/.test(n)) return ["hire"];
  // 이름으로 못 정할 때만 종류로 — 근로계약서류
  if (t.type === "EMPLOYMENT" || t.type === "PART_TIME") return ["hire", "renew"];
  return [];
}

/** 저장값(JSON) → {양식 id: 용도[]}. 모르는 용도 이름은 버린다 */
export function parsePurposeMap(raw: unknown): Record<string, ContractPurpose[]> {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return {}; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, ContractPurpose[]> = {};
  for (const [id, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[id] = [...new Set(list.filter(isPurpose))];
  }
  return out;
}

/** 요청 본문의 용도 목록 검사 — null 은 「기본값으로 되돌리기」. 모양이 틀리면 undefined */
export function normalizePurposes(v: unknown): ContractPurpose[] | null | undefined {
  if (v === null) return null;
  if (!Array.isArray(v) || v.some((x) => !isPurpose(x))) return undefined;
  return [...new Set(v as ContractPurpose[])];
}

/** 이 양식의 실제 용도 — 본부가 정한 값 우선, 없으면 기본값 */
export function purposesOf(t: { id: string; name: string; type?: string | null }, map: Record<string, ContractPurpose[]>): ContractPurpose[] {
  return Object.prototype.hasOwnProperty.call(map, t.id) ? map[t.id] : defaultPurposesOf(t);
}
