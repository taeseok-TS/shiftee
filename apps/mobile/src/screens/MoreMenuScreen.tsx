import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { canApproveNow } from "../services/approvals";

const MENU: { route: string; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { route: "Contracts", label: "계약서", icon: "document-text-outline", color: "#2563eb" },
  { route: "Submissions", label: "자료제출", icon: "cloud-upload-outline", color: "#4f46e5" }, // 2026-09-13 3단계
  { route: "Marketing", label: "마케팅 자료", icon: "camera-outline", color: "#db2777" }, // 2026-09-14 큐브마케팅 연동 ②
  { route: "Suggestions", label: "개선 제안", icon: "bulb-outline", color: "#f59e0b" },
  { route: "Settings", label: "설정", icon: "settings-outline", color: "#6b7280" },
];

// 결재 — 원장·본부·원장대행만 본다(하단 탭에서 옮겨 왔다, 2026-10-07 #17)
const APPROVAL_ITEM = { route: "Approvals", label: "결재", icon: "checkmark-done-circle-outline" as const, color: "#8b5cf6" };

export default function MoreMenuScreen() {
  const navigation = useNavigation<any>();
  const [canApprove, setCanApprove] = useState(false);
  // 대행 기간이 시작·끝날 수 있어 메뉴에 들어올 때마다 다시 판정한다.
  // 「결재」는 맨 아래에 붙인다 — 맨 위에 늦게 끼어들면 줄이 밀려 다른 메뉴를 누르려다 잘못 누른다(검증 지적)
  useFocusEffect(
    useCallback(() => {
      canApproveNow().then((ok) => { if (ok !== null) setCanApprove(ok); }).catch(() => {});   // 실패(null)면 이전 판정 유지
    }, [])
  );
  const items = canApprove ? [...MENU, APPROVAL_ITEM] : MENU;
  return (
    <ScrollView style={styles.container}>
      <View style={styles.group}>
        {items.map((m) => (
          <TouchableOpacity key={m.route} style={styles.row} onPress={() => navigation.navigate(m.route)}>
            <Ionicons name={m.icon} size={22} color={m.color} />
            <Text style={styles.label}>{m.label}</Text>
            <Ionicons name="chevron-forward" size={20} color="#d1d5db" />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  group: { backgroundColor: "#fff", marginTop: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  label: { flex: 1, fontSize: 16, color: "#111827" },
});
