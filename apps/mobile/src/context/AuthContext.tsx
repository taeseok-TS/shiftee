import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as auth from "../services/auth";
import { registerPushToken } from "../services/push";

type AuthContextValue = {
  isLoggedIn: boolean;
  loading: boolean;
  signIn: () => void;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  isLoggedIn: false,
  loading: true,
  signIn: () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [loading, setLoading] = useState(true);

  // 앱 시작 시 저장된 토큰으로 로그인 상태 복원 + 토큰 갱신(슬라이딩 세션)
  // 갱신 실패(만료)면 빈 화면 대신 로그인 화면으로 보낸다
  useEffect(() => {
    (async () => {
      try {
        const ok = await auth.isAuthenticated();
        if (!ok) { setIsLoggedIn(false); return; }
        const token = await auth.refreshToken(); // null = 만료(로그아웃 처리됨)
        setIsLoggedIn(!!token);
        if (token) registerPushToken();
      } catch {
        setIsLoggedIn(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 포그라운드 복귀 때도 토큰 갱신 — 만료됐으면 로그인 화면으로 전환
  useEffect(() => {
    const sub = AppState.addEventListener("change", async (next: AppStateStatus) => {
      if (next !== "active") return;
      const ok = await auth.isAuthenticated();
      if (!ok) return;
      const token = await auth.refreshToken();
      if (!token) setIsLoggedIn(false);
    });
    return () => sub.remove();
  }, []);

  const signIn = useCallback(() => setIsLoggedIn(true), []);

  const signOut = useCallback(async () => {
    await auth.logout();
    setIsLoggedIn(false);
  }, []);

  return (
    <AuthContext.Provider value={{ isLoggedIn, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
