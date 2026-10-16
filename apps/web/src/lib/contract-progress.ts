// 결재 요청 메일의 「어디까지 왔나」 문구(2026-10-16 이예지 QA 8 — 「결재 단계: 2단계」만으로는 원장이 앞 단계를 알기 어려웠다).
// 예) 「본부 서명 완료 → 원장님 차례」, 첫 단계면 「원장님 차례(첫 단계)」. 순수 함수.
type Step = { order: number; status?: string | null; approverId: string | null; approver?: { role?: string | null } | null };

/** 단계의 역할 이름 — 당사자(근로자)·외부 계약자·본부(ADMIN)·원장(MANAGER) */
export function stepRole(s: Step, partyUserId: string | null | undefined, external: boolean): "본부" | "원장" | "근로자" | "계약자" | "결재자" {
  if (!s.approverId) return "계약자";
  if (!external && partyUserId && s.approverId === partyUserId) return "근로자";
  const role = s.approver?.role;
  if (role === "ADMIN") return "본부";
  if (role === "MANAGER") return "원장";
  return "결재자";
}

const honor = (r: string) => (r === "본부" ? "본부" : `${r}님`);

/** 지금 차례(currentOrder)까지의 진행 문구 */
export function approvalProgress(steps: Step[], currentOrder: number, partyUserId: string | null | undefined, external: boolean): { turn: string; text: string } {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  const cur = sorted.find((s) => s.order === currentOrder);
  const turnRole = cur ? stepRole(cur, partyUserId, external) : "결재자";
  // 아직 차례가 안 온(WAITING)·반려된 앞 단계는 「완료」로 적지 않는다 — 거짓 「완료」 방지(검증 8).
  // 서명 처리 경로는 방금 서명한 단계가 갱신 전 값(PENDING)으로 들어오므로 PENDING 은 완료로 본다(앞 단계는 차례대로 끝난다)
  const done = sorted.filter((s) => s.order < currentOrder && s.status !== "WAITING" && s.status !== "REJECTED").map((s) => stepRole(s, partyUserId, external));
  const uniqDone = done.filter((r, i) => done.indexOf(r) === i);
  const text = uniqDone.length ? `${uniqDone.join("·")} 서명 완료 → ${honor(turnRole)} 차례` : `${honor(turnRole)} 차례(첫 단계)`;
  return { turn: turnRole, text };
}
