// 결재자 이름 표기 하나로 맞추기(2026-10-16 이예지 QA N1) — 순수 함수.
// 계정 이름이 「이예지대리」「김태석본부장」처럼 직급이 붙은 것도, 「박정인」처럼 이름만인 것도 있어
// 결재 진행 칸·완료본·증명서에 「이예지대리 → 직원」 「박정인 → 직원」처럼 제각각 나왔다.
// 직원 관리의 이름·직급으로 「이름 직급」(이름 끝에 직급이 이미 붙어 있으면 떼고 띄어 씀)을 만든다. 직급이 없으면 이름 그대로.
export function personLabel(p: { name?: string | null; position?: string | null } | null | undefined): string {
  const name = (p?.name || "").trim();
  const pos = (p?.position || "").trim();
  if (!name) return "";
  if (!pos) return name;
  const base = name.endsWith(pos) && name.length > pos.length ? name.slice(0, -pos.length).trim() : name;
  return `${base} ${pos}`;
}

/** 계약 결재선의 결재자 이름을 표시용으로 바꾼다(응답 직전에 부른다). approver 에 position 이 함께 실려 와야 한다 */
export function labelApproverNames<T extends { approvalLine?: { steps?: { approver?: { name?: string | null; position?: string | null } | null }[] } | null }>(c: T): T {
  for (const s of c.approvalLine?.steps || []) {
    if (s.approver) s.approver.name = personLabel(s.approver) || s.approver.name || "";
  }
  return c;
}
