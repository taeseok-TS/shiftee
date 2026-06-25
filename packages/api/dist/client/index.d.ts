/**
 * ============================================
 * Shiftee API Client - Web & Mobile 공유
 * ============================================
 */
import { ApiResponse, LoginResponse, Contract, CreateContractRequest, ContractSignRequest, LeaveRequest, CreateLeaveRequest, ApproveLeaveRequest, Attendance, ClockInRequest, ClockOutRequest, DashboardStats, Announcement, LeaveBalance, ScheduleEntry, ScheduleRequest, WorkChannel, WorkMessage } from "../types/index";
export declare class ShifteeApiClient {
    private axiosInstance;
    private baseURL;
    private getToken?;
    private onUnauthorized?;
    constructor(baseURL?: string, getToken?: () => Promise<string | null>, onUnauthorized?: () => void);
    /**
     * 인터셉터 설정
     */
    private setupInterceptors;
    /**
     * 에러 처리
     */
    private handleError;
    /**
     * ============== 인증 ==============
     */
    login(email: string, password: string): Promise<LoginResponse>;
    logout(): Promise<void>;
    /**
     * ============== 계약서 ==============
     */
    getContracts(): Promise<Contract[]>;
    getContract(id: string): Promise<Contract>;
    createContract(data: CreateContractRequest): Promise<Contract>;
    updateContract(id: string, data: Partial<CreateContractRequest> & {
        status?: string;
        approverIds?: string[];
    }): Promise<Contract>;
    signContract(id: string, data: ContractSignRequest): Promise<ApiResponse>;
    /**
     * ============== 휴가 ==============
     */
    getLeaveRequests(year?: number, month?: number): Promise<LeaveRequest[]>;
    getLeaveRequest(id: string): Promise<LeaveRequest>;
    createLeaveRequest(data: CreateLeaveRequest): Promise<LeaveRequest>;
    approveLeave(id: string, data: ApproveLeaveRequest): Promise<ApiResponse>;
    getMyLeaveApprovals(): Promise<LeaveRequest[]>;
    /**
     * ============== 출퇴근 ==============
     */
    clockIn(data: ClockInRequest): Promise<Attendance>;
    clockOut(data: ClockOutRequest): Promise<Attendance>;
    getAttendance(date: string): Promise<Attendance[]>;
    getDaySchedule(date: string): Promise<any>;
    /**
     * ============== 결재 승인 ==============
     */
    getMyContractApprovals(): Promise<Contract[]>;
    approveContract(id: string, approved: boolean): Promise<ApiResponse>;
    getDashboardStats(): Promise<DashboardStats>;
    getAnnouncements(): Promise<Announcement[]>;
    getLeaveBalance(): Promise<LeaveBalance | null>;
    getMySchedules(year: number, month: number): Promise<ScheduleEntry[]>;
    getScheduleRequests(status?: string): Promise<ScheduleRequest[]>;
    getChannels(): Promise<WorkChannel[]>;
    getMessages(channelId: string): Promise<WorkMessage[]>;
    sendMessage(channelId: string, content: string): Promise<WorkMessage>;
    markChannelRead(channelId: string): Promise<void>;
}
export declare function initializeApi(baseURL?: string, getToken?: () => Promise<string | null>, onUnauthorized?: () => void): ShifteeApiClient;
export declare function getApiClient(): ShifteeApiClient;
export default ShifteeApiClient;
//# sourceMappingURL=index.d.ts.map