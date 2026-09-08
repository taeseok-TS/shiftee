import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState, AppStateStatus } from "react-native";
import * as auth from "../services/auth";
import { registerPushToken } from "../services/push";
import { onSessionExpired } from "../services/session-events";

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
      if (!token) { setIsLoggedIn(false); return; }
      // 푸시 등록을 다시 심는다. 서버가 세션을 무효화하면(퇴사.기기초기화.비밀번호 변경)
      // 그 사람의 푸시 등록도 함께 지워지므로, 계속 쓰는 기기는 여기서 되살아나야 한다.
      // 같은 토큰을 다시 올리는 것이라 중복은 서버가 걸러낸다.
      registerPushToken();
    });
    return () => sub.remove();
  }, []);

  // 서버가 세션을 끊으면(퇴사.기기초기화.비밀번호 변경) 앱을 껐다 켤 때까지 기다리지 않고
  // 그 자리에서 로그인 화면으로 보낸다 (2026-09-08 디렉터 지시).
  useEffect(() => onSessionExpired(() => setIsLoggedIn(false)), []);

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
