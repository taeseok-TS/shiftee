"use strict";
/**
 * ============================================
 * Shiftee API Client - Web & Mobile 공유
 * ============================================
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ShifteeApiClient = void 0;
exports.initializeApi = initializeApi;
exports.getApiClient = getApiClient;
const axios_1 = __importDefault(require("axios"));
const index_1 = require("../types/index");
class ShifteeApiClient {
    constructor(baseURL = "http://localhost:3000/api", getToken, onUnauthorized) {
        this.baseURL = baseURL;
        this.getToken = getToken;
        this.onUnauthorized = onUnauthorized;
        this.axiosInstance = axios_1.default.create({
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
    setupInterceptors() {
        // 요청 인터셉터: 토큰 자동 추가
        this.axiosInstance.interceptors.request.use(async (config) => {
            if (this.getToken) {
                const token = await this.getToken();
                if (token) {
                    config.headers.Authorization = `Bearer ${token}`;
                }
            }
            return config;
        }, (error) => Promise.reject(this.handleError(error)));
        // 응답 인터셉터: 에러 처리
        this.axiosInstance.interceptors.response.use((response) => response, (error) => {
            if (error.response?.status === 401 && this.onUnauthorized) {
                this.onUnauthorized();
            }
            return Promise.reject(this.handleError(error));
        });
    }
    /**
     * 에러 처리
     */
    handleError(error) {
        if (error.response) {
            const status = error.response.status;
            const message = error.response.data?.error || error.message || "알 수 없는 오류";
            return new index_1.ApiErrorClass(status, message);
        }
        else if (error.request) {
            return new index_1.ApiErrorClass(0, "서버로부터 응답이 없습니다");
        }
        else {
            return new index_1.ApiErrorClass(0, error.message || "알 수 없는 오류");
        }
    }
    /**
     * ============== 인증 ==============
     */
    async login(email, password) {
        const response = await this.axiosInstance.post("/auth/login", {
            email,
            password,
        });
        return response.data;
    }
    async logout() {
        await this.axiosInstance.post("/auth/logout");
    }
    /**
     * ============== 계약서 ==============
     */
    async getContracts() {
        const response = await this.axiosInstance.get("/contracts");
        return response.data.contracts || [];
    }
    async getContract(id) {
        const response = await this.axiosInstance.get(`/contracts/${id}`);
        return response.data.contract;
    }
    async createContract(data) {
        const formData = new FormData();
        formData.append("userId", data.userId);
        formData.append("title", data.title);
        formData.append("type", data.type);
        if (data.startDate)
            formData.append("startDate", data.startDate);
        if (data.endDate)
            formData.append("endDate", data.endDate);
        if (data.templateId)
            formData.append("templateId", data.templateId);
        // 파일 추가
        if (data.files) {
            for (const file of data.files) {
                formData.append("files", file);
            }
        }
        const response = await this.axiosInstance.post("/contracts", formData, {
            headers: {
                "Content-Type": "multipart/form-data",
            },
        });
        return response.data.contract;
    }
    async updateContract(id, data) {
        const response = await this.axiosInstance.patch(`/contracts/${id}`, data);
        return response.data.contract;
    }
    async signContract(id, data) {
        const response = await this.axiosInstance.post(`/contracts/${id}/sign`, data);
        return response.data;
    }
    /**
     * ============== 휴가 ==============
     */
    async getLeaveRequests(year, month) {
        const params = {};
        if (year)
            params.year = year;
        if (month)
            params.month = month;
        const response = await this.axiosInstance.get("/leave", { params });
        return response.data.requests || [];
    }
    async getLeaveRequest(id) {
        const response = await this.axiosInstance.get(`/leave/${id}`);
        return response.data.leave;
    }
    async createLeaveRequest(data) {
        const response = await this.axiosInstance.post("/leave", data);
        return response.data.leaveRequest;
    }
    async approveLeave(id, data) {
        const response = await this.axiosInstance.post(`/leave/${id}/approve`, data);
        return response.data;
    }
    async getMyLeaveApprovals() {
        const response = await this.axiosInstance.get("/leave/my-approvals");
        return response.data.requests || [];
    }
    /**
     * ============== 출퇴근 ==============
     */
    async clockIn(data) {
        const response = await this.axiosInstance.post("/attendance/clock-in", data);
        return response.data;
    }
    async clockOut(data) {
        const response = await this.axiosInstance.post("/attendance/clock-out", data);
        return response.data;
    }
    async getAttendance(date) {
        const response = await this.axiosInstance.get("/attendance", {
            params: { date },
        });
        return response.data.attendances || [];
    }
    async getDaySchedule(date) {
        const response = await this.axiosInstance.get("/schedule/day", { params: { date } });
        return response.data;
    }
    /**
     * ============== 결재 승인 ==============
     */
    async getMyContractApprovals() {
        const response = await this.axiosInstance.get("/contracts/my-approvals");
        return response.data.contracts || [];
    }
    async approveContract(id, approved) {
        const response = await this.axiosInstance.post(`/contracts/${id}/approve`, {
            approved,
        });
        return response.data;
    }
    // ============== 대시보드 / 공지 ==============
    async getDashboardStats() {
        const response = await this.axiosInstance.get("/me/dashboard-stats");
        return response.data;
    }
    async getAnnouncements() {
        const response = await this.axiosInstance.get("/work/announcements");
        return response.data.announcements || [];
    }
    async getLeaveBalance() {
        // scope=self 로 역할과 무관하게 "내 잔여 휴가"만 조회 ( { balance } 반환, 없으면 null )
        const response = await this.axiosInstance.get("/leave/balance", { params: { scope: "self" } });
        return response.data.balance ?? null;
    }
    // ============== 근무일정 ==============
    async getMySchedules(year, month) {
        const response = await this.axiosInstance.get("/schedule", { params: { scope: "self", year, month } });
        return response.data.schedules || [];
    }
    async getScheduleRequests(status) {
        const response = await this.axiosInstance.get("/schedule-requests", { params: status ? { status } : {} });
        return response.data.requests || [];
    }
    // ============== 큐브티워크 (메신저) ==============
    async getChannels() {
        const response = await this.axiosInstance.get("/work/channels");
        return response.data.channels || [];
    }
    async getMessages(channelId) {
        const response = await this.axiosInstance.get(`/work/channels/${channelId}/messages`);
        return response.data.messages || [];
    }
    async sendMessage(channelId, content) {
        const response = await this.axiosInstance.post(`/work/channels/${channelId}/messages`, { content });
        return response.data.message;
    }
    async markChannelRead(channelId) {
        await this.axiosInstance.post(`/work/channels/${channelId}/read`);
    }
}
exports.ShifteeApiClient = ShifteeApiClient;
/**
 * 싱글톤 인스턴스 (선택사항)
 */
let instance = null;
function initializeApi(baseURL, getToken, onUnauthorized) {
    instance = new ShifteeApiClient(baseURL, getToken, onUnauthorized);
    return instance;
}
function getApiClient() {
    if (!instance) {
        throw new Error("API client not initialized. Call initializeApi first.");
    }
    return instance;
}
exports.default = ShifteeApiClient;
//# sourceMappingURL=index.js.map