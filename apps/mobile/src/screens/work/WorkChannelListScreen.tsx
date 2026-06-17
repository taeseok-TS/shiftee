import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { WorkChannel } from "@shiftee/api";
import * as api from "../../services/api";

export default function WorkChannelListScreen() {
  const navigation = useNavigation<any>();
  const [channels, setChannels] = useState<WorkChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await api.getChannels();
      setChannels(c);
    } catch (error) {
      console.error("❌ Failed to load channels:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 화면 포커스 시마다 갱신(읽음/안읽음 반영)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const renderItem = ({ item }: { item: WorkChannel }) => (
    <TouchableOpacity
      style={styles.item}
      onPress={() =>
        navigation.navigate("WorkChat", { channelId: item.id, name: item.name })
      }
    >
      <View style={[styles.avatar, item.type === "DM" && styles.avatarDm]}>
        <Ionicons
          name={item.type === "DM" ? "person" : "people"}
          size={20}
          color="#fff"
        />
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemName} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={styles.itemLast} numberOfLines={1}>
          {item.lastMessage?.content || "메시지가 없습니다"}
        </Text>
      </View>
      {item.unread > 0 && (
        <View style={styles.unreadBadge}>
          <Text style={styles.unreadText}>{item.unread > 99 ? "99+" : item.unread}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

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
      data={channels}
      keyExtractor={(c) => c.id}
      renderItem={renderItem}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={<Text style={styles.empty}>채널이 없습니다.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 40 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#4f46e5",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarDm: { backgroundColor: "#0ea5e9" },
  itemBody: { flex: 1, marginLeft: 12 },
  itemName: { fontSize: 16, fontWeight: "600", color: "#111827" },
  itemLast: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#ef4444",
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  unreadText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
