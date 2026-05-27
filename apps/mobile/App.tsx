import React, { useEffect } from "react";
import { StatusBar } from "expo-status-bar";
import RootNavigator from "./src/navigation/RootNavigator";
import * as api from "./src/services/api";

export default function App() {
  useEffect(() => {
    initializeApp();
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

  return (
    <>
      <StatusBar style="dark" />
      <RootNavigator />
    </>
  );
}
