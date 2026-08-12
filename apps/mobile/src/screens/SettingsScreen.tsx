import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Switch,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Constants from "expo-constants";
import * as ImagePicker from "expo-image-picker";
import * as auth from "../services/auth";
import { useAuth } from "../context/AuthContext";
import { uploadAvatar, getNotifySettings, setNotifyApproval } from "../services/work";
import Avatar from "../components/Avatar";
import type { User } from "@shiftee/api";

export default function SettingsScreen({ navigation }: any) {
  const { signOut } = useAuth();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // 프로필 사진 변경
  const handleChangeAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("권한 필요", "사진 접근 권한을 허용해주세요.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    setUploadingAvatar(true);
    try {
      const name = asset.fileName || `avatar-${Date.now()}.jpg`;
      const { avatarUrl } = await uploadAvatar({ uri: asset.uri, name, mimeType: asset.mimeType });
      setUser((u) => (u ? { ...u, avatarUrl } : u));
    } catch (e: any) {
      Alert.alert("실패", e?.message || "사진 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  // 비밀번호 변경 (임시 비번 1234로 초기화된 경우 여기서 변경)
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  const submitPassword = async () => {
    if (!pwCurrent || !pwNew) { Alert.alert("입력 확인", "현재 비밀번호와 새 비밀번호를 입력해주세요."); return; }
    if (pwNew !== pwConfirm) { Alert.alert("입력 확인", "새 비밀번호가 일치하지 않습니다."); return; }
    setPwSaving(true);
    try {
      await auth.changePassword(pwCurrent, pwNew);
      setPwOpen(false); setPwCurrent(""); setPwNew(""); setPwConfirm("");
      Alert.alert("완료", "비밀번호가 변경되었습니다.");
    } catch (e: any) {
      Alert.alert("변경 실패", e?.message || "비밀번호 변경에 실패했습니다.");
    } finally {
      setPwSaving(false);
    }
  };

  // 결재 결과 알림 설정
  const [notifyApproval, setNotifyApprovalState] = useState(true);
  const [notifyForced, setNotifyForced] = useState(false);

  useEffect(() => {
    loadUser();
    getNotifySettings()
      .then((s) => { setNotifyApprovalState(s.notifyApproval); setNotifyForced(s.forced); })
      .catch(() => {});
  }, []);

  const toggleNotifyApproval = async (on: boolean) => {
    setNotifyApprovalState(on);
    try {
      await setNotifyApproval(on);
    } catch {
      setNotifyApprovalState(!on); // 실패 시 복원
      Alert.alert("오류", "설정 저장 중 오류가 발생했습니다.");
    }
  };

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
            await signOut(); // 로그아웃 + RootNavigator가 로그인 화면으로 전환
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
          <TouchableOpacity onPress={handleChangeAvatar} activeOpacity={0.8} style={styles.avatarWrap}>
            <Avatar name={user.name} size={60} uri={user.avatarUrl} />
            <View style={styles.cameraBadge}>
              {uploadingAvatar ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="camera" size={13} color="#fff" />
              )}
            </View>
          </TouchableOpacity>
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
        <Text style={styles.sectionTitle}>계정</Text>
        <TouchableOpacity style={styles.menuItem} onPress={() => setPwOpen(true)}>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuLabel}>비밀번호 변경</Text>
            <Text style={styles.menuHint}>8자 이상 · 대문자 · 숫자 · 특수문자 포함</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>알림</Text>
        <View style={styles.menuItem}>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuLabel}>결재 결과 알림</Text>
            <Text style={styles.menuHint}>
              {notifyForced ? "관리자 정책으로 항상 발송됩니다" : "휴가·근무일정 결재 승인/반려 시 봇 알림"}
            </Text>
          </View>
          <Switch
            value={notifyForced ? true : notifyApproval}
            onValueChange={toggleNotifyApproval}
            disabled={notifyForced}
            trackColor={{ true: "#4f46e5" }}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>앱 정보</Text>
        <View style={styles.menuItem}>
          <Text style={styles.menuLabel}>버전</Text>
          {/* 하드코딩 금지 — app.json 버전을 그대로 표시 (빌드 시 자동 반영) */}
          <Text style={styles.menuValue}>{Constants.expoConfig?.version ?? "-"}</Text>
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

      {/* 비밀번호 변경 */}
      <Modal visible={pwOpen} transparent animationType="slide" onRequestClose={() => setPwOpen(false)}>
        <KeyboardAvoidingView style={styles.pwBg} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.pwCard}>
            <Text style={styles.pwTitle}>비밀번호 변경</Text>
            <TextInput style={styles.pwInput} placeholder="현재 비밀번호" secureTextEntry
              value={pwCurrent} onChangeText={setPwCurrent} autoCapitalize="none" />
            <TextInput style={styles.pwInput} placeholder="새 비밀번호" secureTextEntry
              value={pwNew} onChangeText={setPwNew} autoCapitalize="none" />
            <TextInput style={styles.pwInput} placeholder="새 비밀번호 확인" secureTextEntry
              value={pwConfirm} onChangeText={setPwConfirm} autoCapitalize="none" />
            <Text style={styles.pwHint}>8자 이상, 대문자·숫자·특수문자를 포함해야 합니다.</Text>
            <View style={styles.pwBtnRow}>
              <TouchableOpacity style={[styles.pwBtn, styles.pwBtnGhost]} onPress={() => setPwOpen(false)}>
                <Text style={styles.pwBtnGhostText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.pwBtn, styles.pwBtnPrimary]} onPress={submitPassword} disabled={pwSaving}>
                <Text style={styles.pwBtnPrimaryText}>{pwSaving ? "변경 중…" : "변경"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  avatarWrap: {
    marginRight: 16,
  },
  cameraBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#2563eb",
    borderWidth: 2,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
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
  menuHint: {
    fontSize: 11,
    color: "#9ca3af",
    marginTop: 2,
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
  // 비밀번호 변경 모달
  pwBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  pwCard: { backgroundColor: "#fff", borderRadius: 14, padding: 20 },
  pwTitle: { fontSize: 17, fontWeight: "700", color: "#1f2937", marginBottom: 14 },
  pwInput: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 8,
    color: "#111827", backgroundColor: "#fff", // 시스템 다크모드에서 흰 글자/흰 배경 반전 방지 (개선 제안 5호)
  },
  pwHint: { fontSize: 11, color: "#9ca3af", marginBottom: 14 },
  pwBtnRow: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  pwBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8 },
  pwBtnGhost: { backgroundColor: "#f3f4f6" },
  pwBtnGhostText: { color: "#6b7280", fontWeight: "600" },
  pwBtnPrimary: { backgroundColor: "#4f46e5" },
  pwBtnPrimaryText: { color: "#fff", fontWeight: "600" },
});
