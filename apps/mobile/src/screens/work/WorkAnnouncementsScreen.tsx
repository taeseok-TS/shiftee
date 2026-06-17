import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Announcement } from "@shiftee/api";
import * as api from "../../services/api";

export default function WorkAnnouncementsScreen() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await api.getAnnouncements());
    } catch (error) {
      console.error("❌ Failed to load announcements:", error);
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={items}
      keyExtractor={(a) => a.id}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={<Text style={styles.empty}>등록된 공지가 없습니다.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <View style={styles.header}>
            {item.pinned && (
              <Ionicons name="pin" size={15} color="#ef4444" style={{ marginRight: 4 }} />
            )}
            <Text style={styles.title}>{item.title}</Text>
          </View>
          <Text style={styles.content}>{item.content}</Text>
          <Text style={styles.meta}>
            {item.authorName} · {new Date(item.createdAt).toLocaleDateString("ko-KR")}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f3f4f6" },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 40 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 10 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 6 },
  title: { fontSize: 16, fontWeight: "bold", color: "#111827", flex: 1 },
  content: { fontSize: 14, color: "#374151", lineHeight: 20 },
  meta: { fontSize: 12, color: "#9ca3af", marginTop: 10 },
});
