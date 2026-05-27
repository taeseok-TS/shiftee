/**
 * ============================================
 * Shiftee Web API Client Wrapper
 * @shiftee/api를 웹에 맞게 래핑
 * ============================================
 */

import { ShifteeApiClient, initializeApi } from "@shiftee/api";
import { getSession } from "./auth";

let apiClient: ShifteeApiClient | null = null;

/**
 * API 클라이언트 초기화 (서버 사이드)
 */
export async function getApiClient(): Promise<ShifteeApiClient> {
  if (!apiClient) {
    // 서버 사이드에서는 getSession으로 토큰 가져오기
    const getServerToken = async () => {
      try {
        const session = await getSession();
        return session?.userId ? "server-session-token" : null;
      } catch {
        return null;
      }
    };

    apiClient = initializeApi(
      process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api",
      getServerToken,
      () => {
        // 401 시 처리 (필요시)
        console.warn("🔐 Unauthorized");
      }
    );
  }

  return apiClient;
}

/**
 * 편의 메서드들 (자주 사용되는 것들)
 */

export async function fetchContracts() {
  const client = await getApiClient();
  return client.getContracts();
}

export async function fetchContract(id: string) {
  const client = await getApiClient();
  return client.getContract(id);
}

export async function fetchLeaveRequests(year?: number, month?: number) {
  const client = await getApiClient();
  return client.getLeaveRequests(year, month);
}

export async function fetchMyLeaveApprovals() {
  const client = await getApiClient();
  return client.getMyLeaveApprovals();
}

export async function fetchMyContractApprovals() {
  const client = await getApiClient();
  return client.getMyContractApprovals();
}

export async function fetchDaySchedule(date: string) {
  const client = await getApiClient();
  return client.getDaySchedule(date);
}
