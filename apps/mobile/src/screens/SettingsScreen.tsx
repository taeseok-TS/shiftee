import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import * as auth from "../services/auth";
import type { User } from "@shiftee/api";

export default function SettingsScreen({ navigation }: any) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadUser();
  }, []);

  const loadUser = async () => {
    try {
      const currentUser = await auth.getCurrentUser();
      setUser(currentUser);
    } catch (error) {
      console.error("❌ Failed to load user:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert("로그아웃", "정말 로그아웃하시겠어요?", [
      { text: "취소", onPress: () => {} },
      {
        text: "확인",
        onPress: async () => {
          try {
            await auth.logout();
            // 네비게이터가 자동으로 로그인 화면으로 이동
          } catch (error) {
            Alert.alert("오류", "로그아웃 중 오류가 발생했습니다");
          }
        },
      },
    ]);
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {user && (
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.charAt(0)}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user.name}</Text>
            <Text style={styles.profileEmail}>{user.email}</Text>
            <Text style={styles.profileRole}>
              {user.role === "ADMIN"
                ? "관리자"
                : user.role === "MANAGER"
                  ? "매니저"
                  : "직원"}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>앱 정보</Text>
        <View style={styles.menuItem}>
          <Text style={styles.menuLabel}>버전</Text>
          <Text style={styles.menuValue}>1.0.0</Text>
        </View>
        <View style={styles.menuItem}>
          <Text style={styles.menuLabel}>개발사</Text>
          <Text style={styles.menuValue}>큐브티</Text>
        </View>
      </View>

      <TouchableOpacity
        style={styles.logoutButton}
        onPress={handleLogout}
      >
        <Text style={styles.logoutButtonText}>로그아웃</Text>
      </TouchableOpacity>

      <Text style={styles.footer}>© 2026 큐브티 HR System</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    padding: 20,
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  profileCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  avatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#2563eb",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: "700",
    color: "#fff",
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 4,
  },
  profileRole: {
    fontSize: 12,
    color: "#9ca3af",
  },
  section: {
    backgroundColor: "#fff",
    borderRadius: 12,
    marginBottom: 20,
    overflow: "hidden",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1f2937",
    padding: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  menuItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  menuLabel: {
    fontSize: 14,
    color: "#6b7280",
  },
  menuValue: {
    fontSize: 14,
    color: "#1f2937",
    fontWeight: "500",
  },
  logoutButton: {
    backgroundColor: "#ef4444",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginBottom: 20,
  },
  logoutButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  footer: {
    textAlign: "center",
    fontSize: 12,
    color: "#9ca3af",
  },
});
