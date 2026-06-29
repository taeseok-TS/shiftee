/**
 * ============================================
 * 큐브티 Mobile - 푸시 알림 서비스
 * 로그인 후 권한 요청 + Expo 푸시 토큰을 서버에 등록.
 * 실제 알림 발송은 서버(/api/work/.../messages)가 Expo Push API로 수행.
 * ============================================
 */

import { Platform } from "react-native";
import axios from "axios";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { API_URL } from "../config";
import { getToken } from "./storage";

// 앱이 포그라운드일 때도 알림 배너/소리를 표시
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// 안드로이드는 소리/진동을 채널 단위로 설정해야 함.
// 채널 설정은 최초 생성 시 잠기므로, 소리/진동을 명시한 새 id로 만든다.
// 서버 푸시의 channelId와 반드시 일치해야 알림이 이 채널로 라우팅됨(FCM V1).
export const ANDROID_CHANNEL_ID = "messages";

async function ensureAndroidChannel() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: "채팅 알림",
    importance: Notifications.AndroidImportance.MAX,
    sound: "default",
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
    lightColor: "#4F46E5",
  });
}

/**
 * 권한 요청 + Expo 푸시 토큰 발급 → 서버 등록.
 * 로그인 직후 호출. 실패해도 앱 동작을 막지 않도록 조용히 처리.
 */
export async function registerPushToken(): Promise<void> {
  try {
    await ensureAndroidChannel();

    // 시뮬레이터/에뮬레이터는 푸시 토큰 발급 불가
    if (!Device.isDevice) return;

    const { status: existing } = await Notifications.getPermissionsAsync();
    let status = existing;
    if (existing !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return;

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn("[push] projectId 없음 — 토큰 발급 생략");
      return;
    }

    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;

    await axios.post(
      `${API_URL}/push/register`,
      { token, platform: Platform.OS },
      { headers: await authHeaders() }
    );
    console.log("✅ 푸시 토큰 등록 완료");
  } catch (e) {
    console.warn("[push] 토큰 등록 실패:", e);
  }
}

/**
 * 로그아웃 시 서버에서 토큰 해제(이 기기로 더 이상 알림 안 옴).
 */
export async function unregisterPushToken(): Promise<void> {
  try {
    if (!Device.isDevice) return;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      Constants.easConfig?.projectId;
    if (!projectId) return;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    if (!token) return;
    await axios.delete(`${API_URL}/push/register`, {
      headers: await authHeaders(),
      data: { token },
    });
  } catch {
    // 무시
  }
}
