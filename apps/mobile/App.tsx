import React, { useEffect, useRef } from "react";
import { AppState, AppStateStatus, TextInput } from "react-native";

// 삼성 등 시스템 다크모드(앱 강제 다크 적용)에서 안내 문구가 흰색으로 뒤집혀
// 안 보이는 문제 방지 — 앱 전체 입력창의 placeholder 색을 명시적으로 고정
// (개별 컴포넌트에서 placeholderTextColor를 지정하면 그쪽이 우선)
type TextInputWithDefaults = typeof TextInput & { defaultProps?: { placeholderTextColor?: string } };
const TI = TextInput as TextInputWithDefaults;
TI.defaultProps = { ...(TI.defaultProps || {}), placeholderTextColor: "#9ca3af" };
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import Constants from "expo-constants";
import * as Sentry from "@sentry/react-native";
import RootNavigator from "./src/navigation/RootNavigator";
import { AuthProvider } from "./src/context/AuthContext";
import * as api from "./src/services/api";

// 앱 크래시·오류 추적 (Sentry). DSN은 app.json extra.sentryDsn — 비어 있으면 비활성.
// 개발 중(__DEV__)에는 보내지 않는다.
const SENTRY_DSN = (Constants.expoConfig?.extra as { sentryDsn?: string } | undefined)?.sentryDsn;
if (SENTRY_DSN && !__DEV__) {
  Sentry.init({
    dsn: SENTRY_DSN,
    sendDefaultPii: false, // 개인정보(이메일 등) 자동 수집 안 함
    tracesSampleRate: 0.1,
  });
}

function App() {
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    initializeApp();
    checkForUpdate();
    // 백그라운드 → 포그라운드 복귀 시에도 OTA 확인(콜드 스타트 안 해도 최신 반영)
    const sub = AppState.addEventListener("change", (next: AppStateStatus) => {
      if (appState.current.match(/inactive|background/) && next === "active") {
        checkForUpdate();
      }
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  const initializeApp = async () => {
    try {
      // API 클라이언트 초기화
      await api.initializeApiClient();
      console.log("✅ App initialized");
    } catch (error) {
      console.error("❌ Failed to initialize app:", error);
    }
  };

  // 시작 시 OTA 업데이트가 있으면 즉시 받아서 적용(재시작 1번에 반영)
  const checkForUpdate = async () => {
    if (__DEV__) return;
    try {
      const res = await Updates.checkForUpdateAsync();
      if (res.isAvailable) {
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      }
    } catch {
      // 오프라인 등은 조용히 무시
    }
  };

  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootNavigator />
    </AuthProvider>
  );
}

// Sentry.wrap: 렌더 오류·성능 추적을 위해 루트 컴포넌트를 감싼다 (DSN 없으면 그대로 통과)
export default Sentry.wrap(App);
