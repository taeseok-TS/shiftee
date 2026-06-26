import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import * as Updates from "expo-updates";
import RootNavigator from "./src/navigation/RootNavigator";
import { AuthProvider } from "./src/context/AuthContext";
import * as api from "./src/services/api";

export default function App() {
  useEffect(() => {
    initializeApp();
    checkForUpdate();
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
