/**
 * ============================================
 * 큐브티 Mobile Auth Service
 * @shiftee/api를 사용하는 인증
 * ============================================
 */

import axios from "axios";
import * as storage from "./storage";
import { ShifteeApiClient, User } from "@shiftee/api";
import { API_URL } from "../config";
import { registerPushToken, unregisterPushToken } from "./push";
import { getDeviceId, getDeviceName, getPlatform } from "./device";

const AUTH_API_URL = API_URL;

/**
 * 로그인
 */
export async function login(email: string, password: string): Promise<User | null> {
  try {
    const response = await axios.post(`${AUTH_API_URL}/auth/login`, {
      email,
      password,
      // 기기 잠금: 첫 로그인 시 이 기기가 자동 등록되고, 이후 다른 기기 로그인은 서버가 차단
      deviceId: await getDeviceId(),
      deviceName: getDeviceName(),
      platform: getPlatform(),
    });

    // 응답 형태: { success, token, user }
    const { token, user } = response.data;
    if (!token) {
      console.error("❌ Login response missing token");
      return null;
    }

    // 토큰 저장 (이후 요청은 Authorization: Bearer 로 전송)
    await storage.saveToken(token);
    await storage.saveUser(user);

    // 업로드 파일 접근 티켓 수급 (서명·계약서 열람용, 실패 무해)
    import("./work").then((w) => w.fetchUploadsTicket()).catch(() => {});

    // 푸시 토큰 등록(권한 요청 포함) — 로그인 흐름을 막지 않게 비동기
    registerPushToken();

    console.log("✅ Login successful");
    return user;
  } catch (error: any) {
    const serverMsg = error.response?.data?.error;
    console.error("❌ Login failed:", serverMsg || error.message);
    // 기기 차단(403) 등 서버 메시지는 화면에 그대로 보여줘야 하므로 throw
    if (serverMsg) throw new Error(serverMsg);
    return null;
  }
}

/**
 * 로그아웃
 */
export async function logout(): Promise<void> {
  try {
    // 이 기기로 더 이상 알림이 오지 않도록 서버에서 토큰 해제(저장소 비우기 전)
    await unregisterPushToken();
    // 로컬 저장소 정리
    await storage.clearAuth();
    console.log("✅ Logout successful");
  } catch (error) {
    console.error("❌ Logout failed:", error);
    // 로컬 저장소는 정리
    await storage.clearAuth();
  }
}

/**
 * 현재 사용자 정보 조회
 */
export async function getCurrentUser(): Promise<User | null> {
  const user = await storage.getUser();
  return user;
}

/**
 * 인증 상태 확인
 */
export async function isAuthenticated(): Promise<boolean> {
  const token = await storage.getToken();
  return !!token;
}

/**
 * 비밀번호 변경 (본인) — 서버 정책: 8자 이상 + 대문자 + 숫자 + 특수문자
 * 관리자가 임시 비번(1234)으로 초기화한 경우, 변경하면 봇의 변경 요청 알림이 멈춘다.
 */
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const token = await storage.getToken();
  try {
    await axios.patch(
      `${AUTH_API_URL}/profile/password`,
      { currentPassword, newPassword, confirmPassword: newPassword },
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }
    );
  } catch (error: any) {
    // 서버 메시지(현재 비번 불일치·강도 미달)를 그대로 화면에 노출
    throw new Error(error.response?.data?.error || "비밀번호 변경에 실패했습니다.");
  }
}

/**
 * 토큰 갱신 (슬라이딩 세션) — 앱 실행/포그라운드 복귀 때마다 호출.
 * 유효한 토큰이면 새 7일 토큰으로 교체돼 계속 쓰는 한 로그인이 유지된다.
 * 반환 null = 토큰 만료(로그아웃 처리됨) → 로그인 화면으로 보내야 함.
 */
export async function refreshToken(): Promise<string | null> {
  const token = await storage.getToken();
  if (!token) return null;
  try {
    const response = await axios.post(
      `${AUTH_API_URL}/auth/refresh`,
      {},
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const newToken = response.data.token;
    await storage.saveToken(newToken);
    console.log("✅ Token refreshed");
    // 업로드 파일 접근 티켓도 함께 갱신 (서명·계약서 이미지·문서 열람용, 실패 무해)
    import("./work").then((w) => w.fetchUploadsTicket()).catch(() => {});
    return newToken;
  } catch (error: any) {
    if (error.response?.status === 401) {
      // 토큰 만료/무효 — 로그아웃 처리 (빈 화면 대신 로그인 화면으로)
      console.warn("🔐 Token expired — logging out");
      await logout();
      return null;
    }
    // 네트워크 오류(오프라인)나 서버 재배포 순간 등은 기존 토큰 유지
    return token;
  }
}
