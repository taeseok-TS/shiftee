// 직군 표시 이름 — 저장 값은 그대로 두고 화면에만 인사카드 표기로 보인다(2026-10-28 이예지: 「코디」는 인사카드에 없는 값, 「코디네이터」로).
// 저장 값 「코디」는 인사명부 연동(lib/portal-roster mapJobGroup)과 계약서 자동 선택이 쓰므로 바꾸지 않는다.
const LABEL: Record<string, string> = { 코디: "코디네이터", CM: "코칭매니저" };   // CM 도 인사카드 표기(2026-10-29 이예지)

export function jobGroupLabel(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return LABEL[s] ?? s;
}

// 표시 이름 → 저장 값(엑셀로 내려받은 「코칭매니저」 · 「코디네이터」를 다시 올려도 저장 값은 그대로 — 2026-10-29)
const VALUE = Object.fromEntries(Object.entries(LABEL).map(([k, v]) => [v, k]));
export function jobGroupValue(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return VALUE[s] ?? s;
}
