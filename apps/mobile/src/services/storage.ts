import * as SecureStore from "expo-secure-store";

const TOKEN_KEY = "auth_token";
const USER_KEY = "user_data";

/**
 * 토큰 저장
 */
export async function saveToken(token: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token);
  } catch (error) {
    console.error("❌ Failed to save token:", error);
    throw error;
  }
}

/**
 * 토큰 조회
 */
export async function getToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(TOKEN_KEY);
  } catch (error) {
    console.error("❌ Failed to get token:", error);
    return null;
  }
}

/**
 * 토큰 삭제
 */
export async function deleteToken(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch (error) {
    console.error("❌ Failed to delete token:", error);
  }
}

/**
 * 사용자 정보 저장
 */
export async function saveUser(userData: any): Promise<void> {
  try {
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(userData));
  } catch (error) {
    console.error("❌ Failed to save user:", error);
  }
}

/**
 * 사용자 정보 조회
 */
export async function getUser(): Promise<any | null> {
  try {
    const userData = await SecureStore.getItemAsync(USER_KEY);
    return userData ? JSON.parse(userData) : null;
  } catch (error) {
    console.error("❌ Failed to get user:", error);
    return null;
  }
}

/**
 * 전체 로그아웃 (토큰 + 사용자 정보 삭제)
 */
export async function clearAuth(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]);
  } catch (error) {
    console.error("❌ Failed to clear auth:", error);
  }
}
