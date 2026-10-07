import { leaveInfo } from "@/lib/leave-catalog";

// 연차에서 차감하는 휴가인가 — 기준표(lib/leave-catalog.ts)의 연차휴가 그룹만 차감한다(2026-10-07 본부 답변 #19).
// 기준표에 없는 유형은 차감하지 않는 쪽이 아니라 **차감하는 쪽**으로 둔다(종전 동작: 목록에 없는 건 차감).
export function isLeaveDeductible(type: string): boolean {
  return leaveInfo(type)?.deducts ?? true;
}
