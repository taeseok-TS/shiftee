/**
 * ============================================
 * Shiftee Mobile Auth Service
 * @shiftee/api를 사용하는 인증
 * ============================================
 */

import axios from "axios";
import * as storage from "./storage";
import { ShifteeApiClient, User } from "@shiftee/api";

const AUTH_API_URL = "http://localhost:3000/api";

/**
 * 로그인
 */
export async function login(email: string, password: string): Promise<User | null> {
  try {
    const response = await axios.post(`${AUTH_API_URL}/auth/login`, {
      email,
      password,
    });

    const { token, ...userData } = response.data;

    // 토큰 저장
    await storage.saveToken(token);
    await storage.saveUser(userData);

    console.log("✅ Login successful");
    return userData;
  } catch (error: any) {
    console.error("❌ Login failed:", error.response?.data?.error || error.message);
    return null;
  }
}

/**
 * 로그아웃
 */
export async function logout(): Promise<void> {
  try {
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
 * 토큰 갱신 (선택사항)
 */
export async function refreshToken(): Promise<string | null> {
  try {
    const token = await storage.getToken();
    if (!token) return null;

    const response = await axios.post(
      `${AUTH_API_URL}/auth/refresh`,
      {},
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const newToken = response.data.token;
    await storage.saveToken(newToken);
    console.log("✅ Token refreshed");
    return newToken;
  } catch (error) {
    console.error("❌ Token refresh failed:", error);
    // 토큰 갱신 실패 시 로그아웃
    await logout();
    return null;
  }
}
