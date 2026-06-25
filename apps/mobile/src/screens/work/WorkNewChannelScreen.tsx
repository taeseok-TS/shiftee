import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { getMembers, createChannel, Member } from "../../services/channels";
import * as storage from "../../services/storage";

type Mode = "CHANNEL" | "DM";

export default function WorkNewChannelScreen() {
  const navigation = useNavigation<any>();
  const [mode, setMode] = useState<Mode>("CHANNEL");
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const me = await storage.getUser();
      const list = await getMembers();
      setMembers(list.filter((m) => m.id !== me?.id)); // 본인 제외
    } catch (error) {
      console.error("❌ Failed to load members:", error);
      Alert.alert("오류", "직원 목록을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => m.name.toLowerCase().includes(q) || (m.branch || "").toLowerCase().includes(q));
  }, [members, search]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(mode === "DM" ? [] : prev); // DM은 단일 선택
      if (prev.has(id) && (mode !== "DM" || next.size === 0)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const switchMode = (m: Mode) => {
    setMode(m);
    setSelected(new Set());
  };

  const canCreate =
    mode === "DM" ? selected.size === 1 : name.trim().length > 0;

  const onCreate = async () => {
    if (!canCreate || creating) return;
    setCreating(true);
    try {
      const memberIds = Array.from(selected);
      if (mode === "DM") {
        const other = members.find((m) => m.id === memberIds[0]);
        const ch = await createChannel({ type: "DM", memberIds });
        navigation.replace("WorkChat", { channelId: ch.id, name: other?.name || "대화" });
      } else {
        const ch = await createChannel({ type: "CHANNEL", name: name.trim(), memberIds });
        navigation.replace("WorkChat", { channelId: ch.id, name: ch.name });
      }
    } catch (error: any) {
      Alert.alert("생성 실패", error?.response?.data?.error || "처리 중 오류가 발생했습니다.");
      setCreating(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* 모드 토글 */}
      <View style={styles.tabs}>
        <TouchableOpacity style={[styles.tab, mode === "CHANNEL" && styles.tabActive]} onPress={() => switchMode("CHANNEL")}>
          <Ionicons name="people" size={16} color={mode === "CHANNEL" ? "#4f46e5" : "#9ca3af"} />
          <Text style={[styles.tabText, mode === "CHANNEL" && styles.tabTextActive]}>그룹 채널</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, mode === "DM" && styles.tabActive]} onPress={() => switchMode("DM")}>
          <Ionicons name="person" size={16} color={mode === "DM" ? "#4f46e5" : "#9ca3af"} />
          <Text style={[styles.tabText, mode === "DM" && styles.tabTextActive]}>1:1 대화</Text>
        </TouchableOpacity>
      </View>

      {mode === "CHANNEL" && (
        <TextInput
          style={styles.nameInput}
          placeholder="채널 이름 (예: 마케팅팀)"
          value={name}
          onChangeText={setName}
        />
      )}

      <Text style={styles.hint}>
        {mode === "DM" ? "대화 상대 1명을 선택하세요" : "초대할 멤버를 선택하세요 (선택 안 해도 됩니다)"}
      </Text>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color="#9ca3af" />
        <TextInput style={styles.searchInput} placeholder="이름·지점 검색" value={search} onChangeText={setSearch} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color="#4f46e5" style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.id}
          ListEmptyComponent={<Text style={styles.empty}>직원이 없습니다.</Text>}
          renderItem={({ item }) => {
            const on = selected.has(item.id);
            return (
              <TouchableOpacity style={styles.row} onPress={() => toggle(item.id)}>
                <View style={[styles.check, on && styles.checkOn]}>
                  {on && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>
                    {item.branch ? `[${item.branch}] ` : ""}{item.name}
                  </Text>
                  {!!(item.department || item.position) && (
                    <Text style={styles.rowSub}>{[item.department, item.position].filter(Boolean).join(" · ")}</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      <TouchableOpacity style={[styles.createBtn, !canCreate && styles.createBtnOff]} disabled={!canCreate || creating} onPress={onCreate}>
        {creating ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.createText}>{mode === "DM" ? "대화 시작" : "채널 만들기"}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  tabs: { flexDirection: "row", padding: 12, gap: 8 },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 40, borderRadius: 8, backgroundColor: "#f3f4f6" },
  tabActive: { backgroundColor: "#eef2ff", borderWidth: 1, borderColor: "#c7d2fe" },
  tabText: { fontSize: 14, color: "#9ca3af", fontWeight: "600" },
  tabTextActive: { color: "#4f46e5" },
  nameInput: { marginHorizontal: 12, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, height: 44, fontSize: 15 },
  hint: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, fontSize: 13, color: "#6b7280" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 6, marginHorizontal: 12, paddingHorizontal: 10, height: 40, borderRadius: 8, backgroundColor: "#f3f4f6" },
  searchInput: { flex: 1, fontSize: 14 },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 40 },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  check: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center", marginRight: 12 },
  checkOn: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  rowName: { fontSize: 15, fontWeight: "600", color: "#111827" },
  rowSub: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  createBtn: { margin: 12, height: 50, borderRadius: 10, backgroundColor: "#4f46e5", alignItems: "center", justifyContent: "center" },
  createBtnOff: { backgroundColor: "#c7d2fe" },
  createText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
