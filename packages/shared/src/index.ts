// API 응답 공통 타입
export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
};

// 페이지네이션
export type PaginatedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// 출퇴근
export type AttendanceSummary = {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  workingMinutes: number;
  status: string;
};

// 휴가 잔여 현황
export type LeaveBalanceSummary = {
  total: number;
  used: number;
  remaining: number;
};

// 직원 기본 정보
export type UserProfile = {
  id: string;
  name: string;
  email: string;
  department: string | null;
  position: string | null;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
};
