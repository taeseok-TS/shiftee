/**
 * API 응답 데이터 필터링 유틸리티
 *
 * 권한에 따라 민감한 정보를 필터링합니다.
 * - ADMIN: 모든 정보 노출
 * - MANAGER: 자신의 지점 직원은 상세정보, 다른 지점 직원은 기본정보만
 * - EMPLOYEE: 자신은 전체, 타인은 기본정보만
 */

export type UserRole = "ADMIN" | "MANAGER" | "EMPLOYEE";

interface UserData {
  id: string;
  name: string;
  email?: string;
  phone?: string | null;
  department?: string | null;
  jobGroup?: string | null;
  position?: string | null;
  branch?: string | null;
  hireDate?: string | null;
  role?: string;
  [key: string]: any;
}

/**
 * 사용자 데이터를 권한에 따라 필터링
 *
 * @param user 필터링할 사용자 데이터
 * @param viewerRole 조회자의 역할
 * @param viewerId 조회자의 ID (EMPLOYEE 권한 필터링용)
 * @param viewerBranch 조회자의 지점 (MANAGER 권한 필터링용)
 * @returns 필터링된 사용자 데이터
 */
export function filterUserData(
  user: UserData | null,
  viewerRole: UserRole,
  viewerId?: string,
  viewerBranch?: string | null
): Partial<UserData> | null {
  if (!user) return null;

  // ADMIN: 모든 정보 노출
  if (viewerRole === "ADMIN") {
    return user;
  }

  // EMPLOYEE 자신의 데이터: 전체 노출
  if (viewerRole === "EMPLOYEE" && viewerId === user.id) {
    return user;
  }

  // MANAGER 자신의 지점 직원: 상세정보 노출
  if (viewerRole === "MANAGER" && user.branch === viewerBranch) {
    return user;
  }

  // 그 외 경우: 기본정보만 노출
  return {
    id: user.id,
    name: user.name,
    position: user.position,
    jobGroup: user.jobGroup,
    branch: user.branch,
  };
}

/**
 * 사용자 배열을 권한에 따라 필터링
 */
export function filterUserDataArray(
  users: UserData[],
  viewerRole: UserRole,
  viewerId?: string,
  viewerBranch?: string | null
): Partial<UserData>[] {
  return users.map(user => filterUserData(user, viewerRole, viewerId, viewerBranch) || {}).filter(u => u.id);
}

/**
 * 계약서 데이터 필터링 (직원정보 포함)
 */
export interface ContractData {
  id: string;
  userId: string;
  title: string;
  type: string;
  status: string;
  fileUrl: string;
  user?: UserData;
  [key: string]: any;
}

export function filterContractData(
  contract: ContractData,
  viewerRole: UserRole,
  viewerId?: string,
  viewerBranch?: string | null
): Partial<ContractData> {
  const filtered = { ...contract };

  // 계약서의 직원정보 필터링
  if (filtered.user) {
    filtered.user = filterUserData(filtered.user, viewerRole, viewerId, viewerBranch) as UserData;
  }

  return filtered;
}

/**
 * 휴가 신청 데이터 필터링
 */
export interface LeaveData {
  id: string;
  userId: string;
  type: string;
  status: string;
  user?: UserData;
  [key: string]: any;
}

export function filterLeaveData(
  leave: LeaveData,
  viewerRole: UserRole,
  viewerId?: string,
  viewerBranch?: string | null
): Partial<LeaveData> {
  const filtered = { ...leave };

  // 휴가 신청의 직원정보 필터링
  if (filtered.user) {
    filtered.user = filterUserData(filtered.user, viewerRole, viewerId, viewerBranch) as UserData;
  }

  return filtered;
}

/**
 * 민감한 필드 목록
 */
export const SENSITIVE_FIELDS = {
  email: true,
  phone: true,
  password: true,
  ssn: true,
  bankAccount: true,
  emergencyContact: true,
};

/**
 * 데이터 객체에서 민감한 필드 제거
 */
export function removeSensitiveFields<T extends Record<string, any>>(
  data: T,
  fieldsToRemove?: string[]
): Partial<T> {
  const fieldsToFilter = fieldsToRemove || Object.keys(SENSITIVE_FIELDS);
  const filtered = { ...data };

  (fieldsToFilter || []).forEach(field => {
    delete filtered[field];
  });

  return filtered;
}

/**
 * API 응답 객체를 감싼 래퍼
 */
export class FilteredResponse<T> {
  constructor(
    public data: T,
    public filtered: boolean = false
  ) {}

  static ok<T>(data: T, filtered: boolean = false) {
    return new FilteredResponse(data, filtered);
  }
}
