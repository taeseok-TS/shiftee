import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { jinhakInfoEnabled, openJinhakInfo } from "../services/jinhakInfo";
import * as storage from "../services/storage";
import { refreshBadges, useBadgeCounts } from "../services/badges";

type Item = { route: string; label: string; icon: keyof typeof Ionicons.glyphMap; color: string; count?: number | null };

// 2026-10-23 본부 요청(앱 1 · 8 · ■1 결재)
//  · 원장 · 본부: 아래 탭이 「승인」이라 본인 휴가 신청은 여기 「내 휴가」
//  · 직원: 결재(승인)할 일이 없다 — 「결재」 줄 없이 「내 요청」만. 단 오늘 원장대행인 직원은 「승인」 줄을 둔다(대행 결재)
//  · 서명할 계약서가 있으면 「계약서」 줄에 주황 숫자
export default function MoreMenuScreen() {
  const navigation = useNavigation<any>();
  const [role, setRole] = useState("");
  const [jinhakOn, setJinhakOn] = useState(false);
  const badges = useBadgeCounts();
  useEffect(() => { storage.getUser().then((u) => setRole(u?.role || "")).catch(() => {}); }, []);
  // 대행 기간이 시작·끝날 수 있어 메뉴에 들어올 때마다 다시 센다(숫자 · 대행 여부)
  useFocusEffect(
    useCallback(() => {
      refreshBadges().catch(() => {});
      jinhakInfoEnabled().then(setJinhakOn).catch(() => {});   // 입학정보실 — 서버가 켜 둔 때만 보인다
    }, [])
  );
  const staff = role === "ADMIN" || role === "MANAGER";
  const items: Item[] = [
    { route: "Contracts", label: "계약서", icon: "document-text-outline", color: "#4f46e5", count: badges.sign },
    ...(staff ? [{ route: "MyLeave", label: "내 휴가", icon: "umbrella-outline" as const, color: "#4f46e5" }] : []),
    { route: "Requests", label: "내 요청", icon: "list-outline", color: "#0891b2" }, // 휴가·근무 변경·출퇴근 수정 요청 한눈에(2026-10-07 #51)
    { route: "Submissions", label: "자료제출", icon: "cloud-upload-outline", color: "#4f46e5" }, // 2026-09-13 3단계
    { route: "Marketing", label: "마케팅 자료", icon: "camera-outline", color: "#db2777" }, // 2026-09-14 큐브마케팅 연동 ②
    { route: "Suggestions", label: "개선 제안", icon: "bulb-outline", color: "#b45309" },
    { route: "Settings", label: "설정", icon: "settings-outline", color: "#6b7280" },
    // 원장대행 직원만 — 맨 아래에 붙인다(늦게 끼어들어 줄이 밀리면 다른 메뉴를 잘못 누른다, 검증 지적)
    ...(!staff && badges.approver ? [{ route: "Approvals", label: "승인", icon: "checkmark-circle-outline" as const, color: "#4f46e5", count: badges.approvals }] : []),
  ];
  return (
    <ScrollView style={styles.container}>
      <View style={styles.group}>
        {items.map((m) => (
          <TouchableOpacity key={m.route} style={styles.row} onPress={() => navigation.navigate(m.route)}>
            <Ionicons name={m.icon} size={22} color={m.color} />
            <Text style={styles.label}>{m.label}</Text>
            {!!m.count && m.count > 0 && (
              <View style={styles.count}><Text style={styles.countText}>{m.count > 99 ? "99+" : m.count}</Text></View>
            )}
            <Ionicons name="chevron-forward" size={20} color="#d1d5db" />
          </TouchableOpacity>
        ))}
      </View>
      {/* 바로가기(밖으로 나가는 것) — 입학정보실(진학입시EX), 2026-10-19 디렉터 결정: 큐브티 직원 전체.
          누르면 서버에서 60초짜리 입장 주소를 받아 브라우저로 연다. 위 묶음과 떼어 둬 「승인」이 붙어도 자리가 안 밀린다 */}
      {jinhakOn && <View style={styles.group}>
        <TouchableOpacity style={styles.row} onPress={() => { void openJinhakInfo(); }}>
          <Ionicons name="school-outline" size={22} color="#4f46e5" />
          <Text style={styles.label}>입학정보실</Text>
          <Ionicons name="open-outline" size={18} color="#9ca3af" />
        </TouchableOpacity>
      </View>}
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
    minHeight: 54,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  label: { flex: 1, fontSize: 16, color: "#111827" },
  count: { minWidth: 22, height: 22, borderRadius: 11, backgroundColor: "#ef4444", alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },   // 아래 탭 배지와 같은 빨강(2026-10-29)
  countText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
