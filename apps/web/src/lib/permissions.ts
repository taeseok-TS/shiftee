/**
 * 권한 관리 유틸리티
 *
 * 역할별 권한 정의:
 * - ADMIN: 전체 시스템 접근
 * - MANAGER: 자신의 지점 직원/데이터만 접근
 * - EMPLOYEE: 자신의 데이터만 접근
 */

export type UserRole = "ADMIN" | "MANAGER" | "EMPLOYEE";

export type PermissionAction =
  // Employee Management
  | "view_own_info"
  | "view_branch_employees"
  | "view_all_employees"
  | "edit_own_info"
  | "edit_branch_employees"
  | "edit_all_employees"
  | "delete_employees"
  | "reset_password"
  | "manage_roles"

  // Contract Management
  | "view_own_contracts"
  | "view_branch_contracts"
  | "view_all_contracts"
  | "create_contracts"
  | "edit_contracts"
  | "delete_contracts"
  | "manage_approvers"
  | "approve_contracts"
  | "manage_templates"

  // Leave Management
  | "create_leave_request"
  | "view_own_leave"
  | "view_branch_leave"
  | "view_all_leave"
  | "approve_leave"
  | "adjust_leave_balance"
  | "manage_approval_lines"

  // Attendance Management
  | "record_attendance"
  | "view_own_attendance"
  | "view_branch_attendance"
  | "view_all_attendance"

  // Branch Management
  | "view_branch_info"
  | "view_all_branches"
  | "manage_branches"

  // Dashboard
  | "view_own_dashboard"
  | "view_team_dashboard"
  | "view_admin_dashboard";

/**
 * 권한 매트릭스 정의
 */
const permissionMatrix: Record<UserRole, PermissionAction[]> = {
  ADMIN: [
    // 모든 권한
    "view_own_info",
    "view_branch_employees",
    "view_all_employees",
    "edit_own_info",
    "edit_branch_employees",
    "edit_all_employees",
    "delete_employees",
    "reset_password",
    "manage_roles",
    "view_own_contracts",
    "view_branch_contracts",
    "view_all_contracts",
    "create_contracts",
    "edit_contracts",
    "delete_contracts",
    "manage_approvers",
    "approve_contracts",
    "manage_templates",
    "create_leave_request",
    "view_own_leave",
    "view_branch_leave",
    "view_all_leave",
    "approve_leave",
    "adjust_leave_balance",
    "manage_approval_lines",
    "record_attendance",
    "view_own_attendance",
    "view_branch_attendance",
    "view_all_attendance",
    "view_branch_info",
    "view_all_branches",
    "manage_branches",
    "view_own_dashboard",
    "view_team_dashboard",
    "view_admin_dashboard",
  ],
  MANAGER: [
    // 자신과 자신의 지점 접근
    "view_own_info",
    "view_branch_employees",
    "edit_own_info",
    "edit_branch_employees",
    "view_own_contracts",
    "view_branch_contracts",
    "create_contracts",
    "edit_contracts",
    "approve_contracts",
    "manage_templates",
    "create_leave_request",
    "view_own_leave",
    "view_branch_leave",
    "approve_leave",
    "adjust_leave_balance",
    "manage_approval_lines",
    "record_attendance",
    "view_own_attendance",
    "view_branch_attendance",
    "view_branch_info",
    "view_all_branches",
    "view_own_dashboard",
    "view_team_dashboard",
  ],
  EMPLOYEE: [
    // 자신의 데이터만 접근
    "view_own_info",
    "edit_own_info",
    "view_own_contracts",
    "create_leave_request",
    "view_own_leave",
    "approve_leave", // 결재 차례일 때만
    "record_attendance",
    "view_own_attendance",
    "view_branch_info",
    "view_own_dashboard",
  ],
};

/**
 * 사용자가 특정 작업을 수행할 권한이 있는지 확인
 *
 * @param role 사용자의 역할
 * @param action 수행하려는 작업
 * @param userBranch 사용자의 지점 (MANAGER의 경우 필수)
 * @param targetBranch 대상 리소스의 지점 (지점별 필터링이 필요한 경우)
 * @returns 권한 있으면 true, 없으면 false
 */
export function hasPermission(
  role: UserRole,
  action: PermissionAction,
  userBranch?: string | null,
  targetBranch?: string | null
): boolean {
  // 기본 권한 확인
  const allowed = permissionMatrix[role]?.includes(action) ?? false;
  if (!allowed) return false;

  // 지점 검증 (MANAGER인 경우)
  if (role === "MANAGER" && targetBranch && userBranch && userBranch !== targetBranch) {
    // 다른 지점 데이터는 view_all_* 권한 없으면 접근 불가
    if (
      action.includes("edit") ||
      action.includes("delete") ||
      action.includes("create") ||
      action.includes("manage") ||
      (action.includes("view") && !action.includes("view_all"))
    ) {
      return false;
    }
  }

  return true;
}

/**
 * 편의 함수들
 */

export function canViewEmployee(
  role: UserRole,
  userBranch?: string | null,
  targetBranch?: string | null
): boolean {
  if (role === "ADMIN") return true;
  if (role === "MANAGER") return userBranch === targetBranch;
  return false;
}

export function canEditEmployee(
  role: UserRole,
  userBranch?: string | null,
  targetBranch?: string | null
): boolean {
  if (role === "ADMIN") return true;
  if (role === "MANAGER") return userBranch === targetBranch;
  return false;
}

export function canDeleteEmployee(role: UserRole): boolean {
  return role === "ADMIN";
}

export function canCreateContract(
  role: UserRole,
  userBranch?: string | null,
  targetBranch?: string | null
): boolean {
  if (role === "ADMIN") return true;
  if (role === "MANAGER") return userBranch === targetBranch;
  return false;
}

export function canApproveContract(
  role: UserRole
): boolean {
  return role !== "EMPLOYEE"; // ADMIN, MANAGER 모두 가능 (결재라인 검증은 별도)
}

export function canManageBranches(role: UserRole): boolean {
  return role === "ADMIN";
}

export function canViewTeamDashboard(role: UserRole): boolean {
  return role === "ADMIN" || role === "MANAGER";
}

export function canViewAdminDashboard(role: UserRole): boolean {
  return role === "ADMIN";
}

/**
 * 권한 요약 정보 반환
 */
export interface PermissionSummary {
  canViewAllEmployees: boolean;
  canManageEmployees: boolean;
  canManageContracts: boolean;
  canManageBranches: boolean;
  canViewTeamDashboard: boolean;
  canViewAdminDashboard: boolean;
}

export function getPermissionSummary(
  role: UserRole
): PermissionSummary {
  return {
    canViewAllEmployees: role === "ADMIN",
    canManageEmployees: role !== "EMPLOYEE",
    canManageContracts: role !== "EMPLOYEE",
    canManageBranches: role === "ADMIN",
    canViewTeamDashboard: role !== "EMPLOYEE",
    canViewAdminDashboard: role === "ADMIN",
  };
}
