// ─── 계약 당사자(근로자)가 그 계약을 볼 수 있는가 — 순수 함수(2026-10-16 이예지 QA E1·E4, 디렉터 「급함」) ──────
// 사고: 본부가 만들기만 한 초안(사직원 등)이 근로자 「내 계약서」에 보이고 파일까지 열렸다. 발송한 뒤에도
//       결재 순서상 근로자 차례가 오기 전(예: 본부 → 원장 → 근로자 에서 본부 서명 전)에 근로자에게 계약서가 보였다.
// 규칙 — 목록·상세·버전·파일(uploads·docs/pdf·완료본·원본·패키지 미리보기) 어디서나 같다:
//  · 초안(DRAFT): 안 보인다
//  · 서명 완료(SIGNED): 보인다(완료 뒤 열람·다운로드 정책 postSignAccess 는 따로)
//  · 진행 중·반려·만료: 당사자 차례가 왔을 때부터 — 당사자 단계보다 앞선 단계가 모두 승인됐어야 한다.
//    당사자가 결재선에 없으면 완료될 때까지 안 보인다. 결재선이 아예 없는 옛 계약(파일만 올린 것)은 종전대로 보인다
//  · 반려·만료는 기본 목록에서 빼고 「숨겨진 결재 포함」일 때만(목록 쪽에서 거른다)
export type VisStep = { order: number; approverId: string | null; status: string };

export function partyTurnReached(userId: string, steps: VisStep[]): boolean {
  const sorted = [...steps].sort((a, b) => a.order - b.order);
  const mine = sorted.find((s) => s.approverId === userId);
  if (!mine) return false;
  return sorted.filter((s) => s.order < mine.order).every((s) => s.status === "APPROVED");
}

export function partyCanSee(c: { status: string; userId: string; steps: VisStep[] | null | undefined }): boolean {
  if (c.status === "DRAFT") return false;
  if (c.status === "SIGNED") return true;
  const steps = c.steps || [];
  if (steps.length === 0) return true;   // 결재선 없는 옛 계약(직접 올린 파일) — 종전 동작
  return partyTurnReached(c.userId, steps);
}

/** 근로자 기본 목록에서 뺄 상태 — 「숨겨진 결재 포함」을 켜야 보인다(E4) */
export const PARTY_HIDDEN_STATUSES = ["REJECTED", "EXPIRED"];
