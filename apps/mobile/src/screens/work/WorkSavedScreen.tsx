import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, RefreshControl } from "react-native";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { getBookmarks, getMentions, SavedItem } from "../../services/work";

// 보관함/멘션 공용 목록 화면 — route param mode: "saved" | "mentions"
export default function WorkSavedScreen({ route }: any) {
  const mode: "saved" | "mentions" = route?.params?.mode === "mentions" ? "mentions" : "saved";
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<SavedItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(mode === "saved" ? await getBookmarks() : await getMentions());
    } catch {
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, [mode]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const preview = (it: SavedItem) =>
    it.content ||
    (it.fileType === "image" ? "🖼️ 사진" : it.fileType === "video" ? "🎬 동영상" : `📎 ${it.fileName || "파일"}`);

  if (!items) {
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
      keyExtractor={(it) => it.messageId}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      ListEmptyComponent={
        <Text style={styles.empty}>
          {mode === "saved" ? "보관한 메시지가 없습니다.\n채팅에서 메시지를 길게 눌러 ⭐ 보관해보세요." : "나를 멘션한 메시지가 없습니다."}
        </Text>
      }
      renderItem={({ item: it }) => (
        <TouchableOpacity
          style={styles.item}
          onPress={() => navigation.navigate("WorkChat", { channelId: it.channelId, name: it.channelName })}
        >
          <Text style={styles.meta}>
            {it.channelName} · {it.userName} · {new Date(it.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
          </Text>
          <Text style={styles.content} numberOfLines={2}>{preview(it)}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f3f4f6" },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 60, lineHeight: 22 },
  item: { backgroundColor: "#fff", marginHorizontal: 10, marginTop: 8, borderRadius: 10, padding: 12 },
  meta: { fontSize: 11, color: "#9ca3af" },
  content: { fontSize: 14, color: "#111827", marginTop: 4, lineHeight: 19 },
});
