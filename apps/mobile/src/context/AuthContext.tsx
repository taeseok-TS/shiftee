import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
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

  // 앱 시작 시 저장된 토큰으로 로그인 상태 복원
  useEffect(() => {
    auth
      .isAuthenticated()
      .then((ok) => {
        setIsLoggedIn(ok);
        // 이미 로그인된 상태면 푸시 토큰을 갱신 등록(권한/토큰 회전 대비)
        if (ok) registerPushToken();
      })
      .catch(() => setIsLoggedIn(false))
      .finally(() => setLoading(false));
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
