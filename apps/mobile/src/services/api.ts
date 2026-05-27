/**
 * ============================================
 * Shiftee Mobile API Client
 * @shiftee/api를 모바일에 맞게 래핑
 * ============================================
 */

import { ShifteeApiClient, initializeApi } from "@shiftee/api";
import { getToken } from "./storage";

let apiClient: ShifteeApiClient | null = null;

/**
 * API 클라이언트 초기화
 */
export async function initializeApiClient(): Promise<ShifteeApiClient> {
  if (!apiClient) {
    // 모바일에서는 SecureStore에서 토큰 가져오기
    apiClient = initializeApi(
      process.env.EXPO_PUBLIC_API_URL || "http://localhost:3000/api",
      getToken,
      () => {
        // 401 시 처리 (RootNavigator에서 인증 상태 확인)
        console.warn("🔐 Unauthorized - token expired");
      }
    );
  }

  return apiClient;
}

/**
 * 초기화된 API 클라이언트 조회
 */
export function getApi(): ShifteeApiClient {
  if (!apiClient) {
    throw new Error("API client not initialized. Call initializeApiClient first.");
  }
  return apiClient;
}

/**
 * ============== 편의 메서드들 ==============
 * (초기화 없이 직접 호출 가능하도록 준비)
 */

export async function getContracts() {
  return getApi().getContracts();
}

export async function getContract(id: string) {
  return getApi().getContract(id);
}

export async function signContract(id: string, signerName: string) {
  return getApi().signContract(id, { signerName });
}

export async function getLeaveRequests(year?: number, month?: number) {
  return getApi().getLeaveRequests(year, month);
}

export async function createLeaveRequest(data: any) {
  return getApi().createLeaveRequest(data);
}

export async function approveLeave(id: string, action: "approve" | "reject", reason?: string) {
  return getApi().approveLeave(id, { action, reason });
}

export async function clockIn(latitude: number, longitude: number) {
  return getApi().clockIn({ latitude, longitude });
}

export async function clockOut(latitude: number, longitude: number) {
  return getApi().clockOut({ latitude, longitude });
}

export async function getAttendance(date: string) {
  return getApi().getAttendance(date);
}

export async function getDaySchedule(date: string) {
  return getApi().getDaySchedule(date);
}

export async function getMyLeaveApprovals() {
  return getApi().getMyLeaveApprovals();
}

export async function getMyContractApprovals() {
  return getApi().getMyContractApprovals();
}
