/**
 * ============================================
 * Shiftee API - 공유 타입 정의
 * Web과 Mobile이 함께 사용하는 타입
 * ============================================
 */

// ============== 사용자 & 인증 ==============

export interface User {
  id: string;
  email: string;
  name: string;
  role: "ADMIN" | "MANAGER" | "EMPLOYEE";
  branch: string | null;
  department?: string | null;
  position?: string | null;
}

export interface Session extends User {
  userId: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// ============== 계약서 ==============

export type ContractStatus = "DRAFT" | "SENT" | "SIGNED" | "APPROVED" | "REJECTED";
export type ContractType = string; // "근로계약서", "계약서" 등

export interface Contract {
  id: string;
  userId: string;
  title: string;
  type: ContractType;
  fileUrl: string; // JSON 배열로 저장됨 (다중 파일)
  status: ContractStatus;
  startDate: string | null;
  endDate: string | null;
  createdAt: string;
  updatedAt?: string;
  hideRevoked?: boolean; // 회수된 결재 숨김 여부
  revocationLog?: any[]; // 회수 이력
  employeeSignedAt?: string | null;
  signedAt?: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    department?: string | null;
    branch?: string | null;
  };
  approvalLine?: {
    id: string;
    steps: ContractApprovalStep[];
  };
}

export interface ContractApprovalStep {
  id: string;
  order: number;
  status: "WAITING" | "PENDING" | "APPROVED" | "REJECTED";
  approverId: string;
  approver: {
    id: string;
    name: string;
    branch?: string | null;
  };
  decidedAt?: string | null;
}

export interface CreateContractRequest {
  userId: string;
  title: string;
  type: string;
  files?: any[]; // 모바일/웹에서 파일 업로드 (File | Blob)
  templateId?: string;
  startDate?: string;
  endDate?: string;
}

export interface ContractSignRequest {
  signerName: string;
  approverIds?: string[]; // 승인자 설정
}

// ============== 휴가 ==============

export type LeaveStatus = "PENDING" | "APPROVED" | "REJECTED";
export type LeaveType = "ANNUAL" | "SICK" | "PERSONAL" | "MATERNITY" | "BEREAVEMENT" | "HALF_AM" | "HALF_PM" | "QUARTER_AM" | "QUARTER_PM";

export interface LeaveRequest {
  id: string;
  userId: string;
  type: LeaveType;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: LeaveStatus;
  approverId?: string | null;
  rejectedReason?: string | null;
  createdAt: string;
  updatedAt?: string;
  user: {
    id: string;
    name: string;
    email: string;
    branch?: string | null;
  };
  approvalSteps?: LeaveApprovalStep[];
}

export interface LeaveApprovalStep {
  id: string;
  order: number;
  status: "WAITING" | "PENDING" | "APPROVED" | "REJECTED";
  approverId: string;
  approver: {
    id: string;
    name: string;
    email: string;
  };
  comment?: string | null;
  decidedAt?: string | null;
}

export interface CreateLeaveRequest {
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason?: string;
}

export interface ApproveLeaveRequest {
  action: "approve" | "reject";
  reason?: string;
}

// ============== 출퇴근 ==============

export type AttendanceStatus = "NORMAL" | "LATE" | "EARLY_LEAVE" | "ABSENT" | "LEAVE" | "OFF" | "HOLIDAY" | "NO_SCHEDULE" | "NOT_YET";

export interface Attendance {
  id: string;
  userId: string;
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  status: AttendanceStatus;
  latitude?: number;
  longitude?: number;
}

export interface ClockInRequest {
  latitude: number;
  longitude: number;
}

export interface ClockOutRequest {
  latitude: number;
  longitude: number;
}

// ============== 지점 ==============

export interface Branch {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  radius?: number;
  createdAt?: string;
}

// ============== API 응답 ==============

export interface ApiResponse<T = any> {
  success?: boolean;
  data?: T;
  error?: string;
  [key: string]: any; // 유연성을 위해 추가 필드 허용
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ============== 에러 ==============

export interface ApiError {
  status: number;
  message: string;
  code?: string;
  details?: Record<string, any>;
}

export class ApiErrorClass extends Error implements ApiError {
  status: number;
  code?: string;
  details?: Record<string, any>;

  constructor(status: number, message: string, code?: string, details?: Record<string, any>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ============== 휴가 잔여 ==============

export interface LeaveBalance {
  userId: string;
  year: number;
  total: number;
  used: number;
  remaining: number;
}

// ============== 대시보드 ==============

export interface DashboardStats {
  leaveRemaining: number;
  pendingContracts: number;
  pendingApprovals: number;
  monthWorkHours: number;
}

// ============== 공지 ==============

export interface Announcement {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  attachments: string[];
  authorName: string;
  createdAt: string;
  canEdit: boolean;
}
