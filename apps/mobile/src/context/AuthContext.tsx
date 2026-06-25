import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import * as auth from "../services/auth";

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
      .then(setIsLoggedIn)
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
