import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DashboardStats, Announcement } from "@shiftee/api";
import * as api from "../services/api";
import * as storage from "../services/storage";

export default function HomeScreen() {
  const [userName, setUserName] = useState("");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [user, s, anns] = await Promise.all([
        storage.getUser(),
        api.getDashboardStats(),
        api.getAnnouncements(),
      ]);
      setUserName(user?.name ?? "");
      setStats(s);
      setAnnouncements(anns.slice(0, 5));
    } catch (error) {
      console.error("❌ Failed to load home:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const cards = [
    { label: "잔여 연차", value: `${stats?.leaveRemaining ?? 0}일`, icon: "umbrella-outline", color: "#10b981" },
    { label: "서명 대기 계약", value: `${stats?.pendingContracts ?? 0}건`, icon: "document-text-outline", color: "#f59e0b" },
    { label: "대기 결재", value: `${stats?.pendingApprovals ?? 0}건`, icon: "hourglass-outline", color: "#8b5cf6" },
    { label: "이번 달 근무", value: `${stats?.monthWorkHours ?? 0}시간`, icon: "time-outline", color: "#2563eb" },
  ] as const;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>안녕하세요,</Text>
        <Text style={styles.name}>{userName || "사용자"}님 👋</Text>
        <Text style={styles.date}>{dateStr}</Text>
      </View>

      <View style={styles.grid}>
        {cards.map((c) => (
          <View key={c.label} style={styles.card}>
            <Ionicons name={c.icon as any} size={24} color={c.color} />
            <Text style={styles.cardValue}>{c.value}</Text>
            <Text style={styles.cardLabel}>{c.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>최근 공지</Text>
        {announcements.length === 0 ? (
          <Text style={styles.empty}>등록된 공지가 없습니다.</Text>
        ) : (
          announcements.map((a) => (
            <View key={a.id} style={styles.annItem}>
              <View style={styles.annHeader}>
                {a.pinned && (
                  <Ionicons name="pin" size={14} color="#ef4444" style={{ marginRight: 4 }} />
                )}
                <Text style={styles.annTitle} numberOfLines={1}>
                  {a.title}
                </Text>
              </View>
              <Text style={styles.annContent} numberOfLines={2}>
                {a.content}
              </Text>
              <Text style={styles.annMeta}>
                {a.authorName} · {new Date(a.createdAt).toLocaleDateString("ko-KR")}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f3f4f6" },
  header: { padding: 20, paddingTop: 24, backgroundColor: "#fff" },
  greeting: { fontSize: 14, color: "#6b7280" },
  name: { fontSize: 24, fontWeight: "bold", color: "#111827", marginTop: 2 },
  date: { fontSize: 13, color: "#9ca3af", marginTop: 6 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    justifyContent: "space-between",
  },
  card: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardValue: { fontSize: 22, fontWeight: "bold", color: "#111827", marginTop: 8 },
  cardLabel: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  section: { padding: 16, paddingTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#111827", marginBottom: 10 },
  empty: { color: "#9ca3af", fontSize: 14, paddingVertical: 12 },
  annItem: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  annHeader: { flexDirection: "row", alignItems: "center" },
  annTitle: { fontSize: 15, fontWeight: "600", color: "#111827", flex: 1 },
  annContent: { fontSize: 13, color: "#4b5563", marginTop: 4 },
  annMeta: { fontSize: 12, color: "#9ca3af", marginTop: 6 },
});
