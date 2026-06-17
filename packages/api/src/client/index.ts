/**
 * ============================================
 * Shiftee API Client - Web & Mobile 공유
 * ============================================
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from "axios";
import {
  ApiResponse,
  ApiError,
  ApiErrorClass,
  LoginRequest,
  LoginResponse,
  Contract,
  CreateContractRequest,
  ContractSignRequest,
  LeaveRequest,
  CreateLeaveRequest,
  ApproveLeaveRequest,
  Attendance,
  ClockInRequest,
  ClockOutRequest,
  DashboardStats,
  Announcement,
  LeaveBalance,
  ScheduleEntry,
  ScheduleRequest,
} from "../types/index";

export class ShifteeApiClient {
  private axiosInstance: AxiosInstance;
  private baseURL: string;
  private getToken?: () => Promise<string | null>;
  private onUnauthorized?: () => void;

  constructor(
    baseURL: string = "http://localhost:3000/api",
    getToken?: () => Promise<string | null>,
    onUnauthorized?: () => void
  ) {
    this.baseURL = baseURL;
    this.getToken = getToken;
    this.onUnauthorized = onUnauthorized;

    this.axiosInstance = axios.create({
      baseURL,
      timeout: 30000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    this.setupInterceptors();
  }

  /**
   * 인터셉터 설정
   */
  private setupInterceptors() {
    // 요청 인터셉터: 토큰 자동 추가
    this.axiosInstance.interceptors.request.use(
      async (config: InternalAxiosRequestConfig) => {
        if (this.getToken) {
          const token = await this.getToken();
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        }
        return config;
      },
      (error: any) => Promise.reject(this.handleError(error))
    );

    // 응답 인터셉터: 에러 처리
    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401 && this.onUnauthorized) {
          this.onUnauthorized();
        }
        return Promise.reject(this.handleError(error));
      }
    );
  }

  /**
   * 에러 처리
   */
  private handleError(error: any): ApiErrorClass {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.error || error.message || "알 수 없는 오류";
      return new ApiErrorClass(status, message);
    } else if (error.request) {
      return new ApiErrorClass(0, "서버로부터 응답이 없습니다");
    } else {
      return new ApiErrorClass(0, error.message || "알 수 없는 오류");
    }
  }

  /**
   * ============== 인증 ==============
   */

  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await this.axiosInstance.post<LoginResponse>("/auth/login", {
      email,
      password,
    });
    return response.data;
  }

  async logout(): Promise<void> {
    await this.axiosInstance.post("/auth/logout");
  }

  /**
   * ============== 계약서 ==============
   */

  async getContracts(): Promise<Contract[]> {
    const response = await this.axiosInstance.get<ApiResponse<{ contracts: Contract[] }>>("/contracts");
    return response.data.contracts || [];
  }

  async getContract(id: string): Promise<Contract> {
    const response = await this.axiosInstance.get<ApiResponse<{ contract: Contract }>>(`/contracts/${id}`);
    return response.data.contract;
  }

  async createContract(data: CreateContractRequest): Promise<Contract> {
    const formData = new FormData();
    formData.append("userId", data.userId);
    formData.append("title", data.title);
    formData.append("type", data.type);

    if (data.startDate) formData.append("startDate", data.startDate);
    if (data.endDate) formData.append("endDate", data.endDate);
    if (data.templateId) formData.append("templateId", data.templateId);

    // 파일 추가
    if (data.files) {
      for (const file of data.files) {
        formData.append("files", file);
      }
    }

    const response = await this.axiosInstance.post<ApiResponse<{ contract: Contract }>>("/contracts", formData, {
      headers: {
        "Content-Type": "multipart/form-data",
      },
    });
    return response.data.contract;
  }

  async updateContract(id: string, data: Partial<CreateContractRequest> & { status?: string; approverIds?: string[] }): Promise<Contract> {
    const response = await this.axiosInstance.patch<ApiResponse<{ contract: Contract }>>(`/contracts/${id}`, data);
    return response.data.contract;
  }

  async signContract(id: string, data: ContractSignRequest): Promise<ApiResponse> {
    const response = await this.axiosInstance.post<ApiResponse>(`/contracts/${id}/sign`, data);
    return response.data;
  }

  /**
   * ============== 휴가 ==============
   */

  async getLeaveRequests(year?: number, month?: number): Promise<LeaveRequest[]> {
    const params: any = {};
    if (year) params.year = year;
    if (month) params.month = month;

    const response = await this.axiosInstance.get<ApiResponse<{ requests: LeaveRequest[] }>>("/leave", { params });
    return response.data.requests || [];
  }

  async getLeaveRequest(id: string): Promise<LeaveRequest> {
    const response = await this.axiosInstance.get<ApiResponse<{ leave: LeaveRequest }>>(`/leave/${id}`);
    return response.data.leave;
  }

  async createLeaveRequest(data: CreateLeaveRequest): Promise<LeaveRequest> {
    const response = await this.axiosInstance.post<ApiResponse<{ leaveRequest: LeaveRequest }>>("/leave", data);
    return response.data.leaveRequest;
  }

  async approveLeave(id: string, data: ApproveLeaveRequest): Promise<ApiResponse> {
    const response = await this.axiosInstance.post<ApiResponse>(`/leave/${id}/approve`, data);
    return response.data;
  }

  async getMyLeaveApprovals(): Promise<LeaveRequest[]> {
    const response = await this.axiosInstance.get<ApiResponse<{ requests: LeaveRequest[] }>>("/leave/my-approvals");
    return response.data.requests || [];
  }

  /**
   * ============== 출퇴근 ==============
   */

  async clockIn(data: ClockInRequest): Promise<Attendance> {
    const response = await this.axiosInstance.post<ApiResponse<Attendance>>("/attendance/clock-in", data);
    return response.data as any;
  }

  async clockOut(data: ClockOutRequest): Promise<Attendance> {
    const response = await this.axiosInstance.post<ApiResponse<Attendance>>("/attendance/clock-out", data);
    return response.data as any;
  }

  async getAttendance(date: string): Promise<Attendance[]> {
    const response = await this.axiosInstance.get<ApiResponse<{ attendances: Attendance[] }>>("/attendance", {
      params: { date },
    });
    return response.data.attendances || [];
  }

  async getDaySchedule(date: string): Promise<any> {
    const response = await this.axiosInstance.get("/schedule/day", { params: { date } });
    return response.data;
  }

  /**
   * ============== 결재 승인 ==============
   */

  async getMyContractApprovals(): Promise<Contract[]> {
    const response = await this.axiosInstance.get<ApiResponse<{ contracts: Contract[] }>>("/contracts/my-approvals");
    return response.data.contracts || [];
  }

  async approveContract(id: string, approved: boolean): Promise<ApiResponse> {
    const response = await this.axiosInstance.post<ApiResponse>(`/contracts/${id}/approve`, {
      approved,
    });
    return response.data;
  }

  // ============== 대시보드 / 공지 ==============

  async getDashboardStats(): Promise<DashboardStats> {
    const response = await this.axiosInstance.get<DashboardStats>("/me/dashboard-stats");
    return response.data;
  }

  async getAnnouncements(): Promise<Announcement[]> {
    const response = await this.axiosInstance.get<ApiResponse<{ announcements: Announcement[] }>>("/work/announcements");
    return response.data.announcements || [];
  }

  async getLeaveBalance(): Promise<LeaveBalance | null> {
    // scope=self 로 역할과 무관하게 "내 잔여 휴가"만 조회 ( { balance } 반환, 없으면 null )
    const response = await this.axiosInstance.get<ApiResponse<{ balance: LeaveBalance | null }>>(
      "/leave/balance",
      { params: { scope: "self" } }
    );
    return response.data.balance ?? null;
  }

  // ============== 근무일정 ==============

  async getMySchedules(year: number, month: number): Promise<ScheduleEntry[]> {
    const response = await this.axiosInstance.get<ApiResponse<{ schedules: ScheduleEntry[] }>>(
      "/schedule",
      { params: { scope: "self", year, month } }
    );
    return response.data.schedules || [];
  }

  async getScheduleRequests(status?: string): Promise<ScheduleRequest[]> {
    const response = await this.axiosInstance.get<ApiResponse<{ requests: ScheduleRequest[] }>>(
      "/schedule-requests",
      { params: status ? { status } : {} }
    );
    return response.data.requests || [];
  }
}

/**
 * 싱글톤 인스턴스 (선택사항)
 */
let instance: ShifteeApiClient | null = null;

export function initializeApi(
  baseURL?: string,
  getToken?: () => Promise<string | null>,
  onUnauthorized?: () => void
): ShifteeApiClient {
  instance = new ShifteeApiClient(baseURL, getToken, onUnauthorized);
  return instance;
}

export function getApiClient(): ShifteeApiClient {
  if (!instance) {
    throw new Error("API client not initialized. Call initializeApi first.");
  }
  return instance;
}

export default ShifteeApiClient;
