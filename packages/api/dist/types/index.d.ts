/**
 * ============================================
 * Shiftee API - 공유 타입 정의
 * Web과 Mobile이 함께 사용하는 타입
 * ============================================
 */
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
export type ContractStatus = "DRAFT" | "SENT" | "SIGNED" | "APPROVED" | "REJECTED";
export type ContractType = string;
export interface Contract {
    id: string;
    userId: string;
    title: string;
    type: ContractType;
    fileUrl: string;
    signedUrl?: string | null;
    status: ContractStatus;
    startDate: string | null;
    endDate: string | null;
    createdAt: string;
    updatedAt?: string;
    hideRevoked?: boolean;
    revocationLog?: any[];
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
    files?: any[];
    templateId?: string;
    startDate?: string;
    endDate?: string;
}
export interface ContractSignRequest {
    signatureData: string;
    isApprover?: boolean;
}
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
export interface Branch {
    id: string;
    name: string;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    radius?: number;
    createdAt?: string;
}
export interface ApiResponse<T = any> {
    success?: boolean;
    data?: T;
    error?: string;
    [key: string]: any;
}
export interface PaginatedResponse<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
}
export interface ApiError {
    status: number;
    message: string;
    code?: string;
    details?: Record<string, any>;
}
export declare class ApiErrorClass extends Error implements ApiError {
    status: number;
    code?: string;
    details?: Record<string, any>;
    constructor(status: number, message: string, code?: string, details?: Record<string, any>);
}
export interface LeaveBalance {
    userId: string;
    year: number;
    total: number;
    used: number;
    remaining: number;
}
export type WorkChannelType = "CHANNEL" | "DM";
export interface WorkChannel {
    id: string;
    name: string;
    type: WorkChannelType;
    isDefault: boolean;
    memberCount: number;
    unread: number;
    notify: string;
    lastMessage: {
        content: string;
        createdAt: string;
    } | null;
}
export interface WorkMessage {
    id: string;
    userId: string;
    userName: string;
    content: string;
    fileUrl: string | null;
    fileName: string | null;
    fileType: string | null;
    createdAt: string;
    mine: boolean;
    reactions: any[];
    replyCount: number;
    parentId?: string | null;
}
export interface DashboardStats {
    leaveRemaining: number;
    pendingContracts: number;
    pendingApprovals: number;
    monthWorkHours: number;
}
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
export interface ScheduleEntry {
    id: string;
    userId: string;
    date: string;
    startTime: string;
    endTime: string;
    type: string;
    note: string | null;
    branch: string | null;
}
export type ScheduleRequestStatus = "PENDING" | "APPROVED" | "REJECTED";
export interface ScheduleApprovalStep {
    id: string;
    order: number;
    status: string;
    approver?: {
        id: string;
        name: string;
        position: string | null;
    } | null;
}
export interface ScheduleRequest {
    id: string;
    userId: string;
    templateId: string | null;
    templateName: string | null;
    startDate: string;
    endDate: string;
    scheduleData: any;
    totalHours: number;
    status: ScheduleRequestStatus;
    reason: string | null;
    createdAt: string;
    updatedAt: string;
    approvalSteps?: ScheduleApprovalStep[];
}
//# sourceMappingURL=index.d.ts.map