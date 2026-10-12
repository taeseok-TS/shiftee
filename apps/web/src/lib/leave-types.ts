import { leaveInfo } from "@/lib/leave-catalog";

// 연차에서 차감하는 휴가인가 — 기준표(lib/leave-catalog.ts)의 연차휴가 그룹만 차감한다(2026-10-07 본부 답변 #19).
// 기준표에 없는 옛 유형은 차감하는 쪽으로 둔다(종전 동작). 다만 본부가 만든 유형(CUSTOM_…)이 아직 적재되지 않았으면
// **차감하지 않는다** — 적재 전에 결재가 들어와 연차가 잘못 깎이는 쪽이 더 나쁘다(485880f 검증 F2). 결재·취소 라우트는 먼저 ensureLeaveCatalog 를 부른다
export function isLeaveDeductible(type: string): boolean {
  const info = leaveInfo(type);
  if (info) return info.deducts;
  return !type.startsWith("CUSTOM_");
}
