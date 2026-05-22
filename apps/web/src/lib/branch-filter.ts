import type { JWTPayload } from "@/lib/auth";

/**
 * User 테이블 직접 조회 시 where 조건
 * ADMIN     → 전체
 * MANAGER   → 같은 지점 구성원
 * EMPLOYEE  → 본인만
 */
export function userBranchWhere(session: JWTPayload): Record<string, unknown> {
  if (session.role === "ADMIN")   return {};
  if (session.role === "MANAGER") return { branch: session.branch };
  return { id: session.userId };
}

/**
 * Attendance / LeaveRequest / Schedule 등 관계 테이블 조회 시 where 조건
 * (user 관계를 통해 branch 필터링)
 * ADMIN     → 전체
 * MANAGER   → 같은 지점 구성원
 * EMPLOYEE  → 본인만
 */
export function relatedBranchWhere(session: JWTPayload): Record<string, unknown> {
  if (session.role === "ADMIN")   return {};
  if (session.role === "MANAGER") return { user: { branch: session.branch } };
  return { userId: session.userId };
}

/**
 * MANAGER가 특정 userId에 접근 가능한지 확인
 * ADMIN이면 항상 true, MANAGER는 같은 지점인지 DB 확인 필요
 */
export function canAccessUser(session: JWTPayload, targetUserId: string): boolean {
  if (session.role === "ADMIN")   return true;
  if (session.role === "EMPLOYEE") return session.userId === targetUserId;
  // MANAGER: 같은 지점 여부는 별도 DB 조회로 확인
  return true; // 실제 검증은 API 단에서 수행
}
