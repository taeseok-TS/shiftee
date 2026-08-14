/**
 * ============================================
 * 큐브티 Mobile - 기기 식별 (출퇴근 기기 잠금용)
 * 첫 실행 시 UUID를 생성해 SecureStore에 보관.
 * iOS는 키체인이라 앱 재설치에도 유지, Android는 재설치 시 재발급
 * (재발급되면 로그인 차단 → 관리자 기기 초기화로 해결).
 * ============================================
 */

import * as SecureStore from "expo-secure-store";
import * as Device from "expo-device";
import { Platform } from "react-native";

const DEVICE_ID_KEY = "qubetee_device_id";

function makeUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export async function getDeviceId(): Promise<string> {
  try {
    let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
    if (!id) {
      id = makeUuid();
      await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    // SecureStore 실패 시(드묾) 세션 한정 ID — 서버가 등록 기기와 비교하므로 안전
    return makeUuid();
  }
}

export function getDeviceName(): string {
  return Device.deviceName || Device.modelName || (Platform.OS === "ios" ? "iPhone" : "Android");
}

export function getPlatform(): string {
  return Platform.OS;
}
