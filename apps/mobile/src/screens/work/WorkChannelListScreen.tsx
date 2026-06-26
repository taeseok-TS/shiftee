import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  PanResponder,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { WorkChannel } from "@shiftee/api";
import * as api from "../../services/api";
import * as storage from "../../services/storage";
import { deleteChannel, leaveChannel } from "../../services/channels";

const ACTION_W = 84;

// 스와이프 가능한 채널 행 (왼쪽으로 밀면 삭제/나가기 버튼)
function SwipeableChannelRow({
  item,
  onOpen,
  onAction,
}: {
  item: WorkChannel;
  onOpen: () => void;
  onAction: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const isDefault = item.isDefault;
  const amCreator = (item as any).amCreator === true;
  const actionLabel = item.type === "CHANNEL" && amCreator ? "삭제" : "나가기";

  const animate = (to: number) => {
    openRef.current = to !== 0;
    Animated.timing(translateX, { toValue: to, duration: 150, useNativeDriver: true }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !isDefault && Math.abs(g.dx) > Math.abs(g.dy) * 1.5 && Math.abs(g.dx) > 8,
      onPanResponderMove: (_e, g) => {
        let x = (openRef.current ? -ACTION_W : 0) + g.dx;
        if (x > 0) x = 0;
        if (x < -ACTION_W) x = -ACTION_W;
        translateX.setValue(x);
      },
      onPanResponderRelease: (_e, g) => {
        animate(g.dx < -ACTION_W / 2 ? -ACTION_W : 0);
      },
    })
  ).current;

  return (
    <View style={styles.swipeWrap}>
      {!isDefault && (
        <TouchableOpacity
          style={[styles.actionBtn, actionLabel === "삭제" ? styles.actionDelete : styles.actionLeave]}
          onPress={() => {
            animate(0);
            onAction();
          }}
        >
          <Ionicons name={actionLabel === "삭제" ? "trash" : "exit-outline"} size={20} color="#fff" />
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
      <Animated.View style={[styles.rowAnimated, { transform: [{ translateX }] }]} {...pan.panHandlers}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.item}
          onPress={() => {
            if (openRef.current) animate(0);
            else onOpen();
          }}
        >
          <View style={[styles.avatar, item.type === "DM" && styles.avatarDm]}>
            <Ionicons name={item.type === "DM" ? "person" : "people"} size={20} color="#fff" />
          </View>
          <View style={styles.itemBody}>
            <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
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
      </Animated.View>
    </View>
  );
}

export default function WorkChannelListScreen() {
  const navigation = useNavigation<any>();
  const [channels, setChannels] = useState<WorkChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId, setMyId] = useState("");

  useEffect(() => {
    storage.getUser().then((u) => setMyId(u?.id || "")).catch(() => {});
  }, []);

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

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  // 방장(그룹 생성자)·DM → 채널 삭제 / 그 외 멤버 → 나가기
  const handleAction = (item: WorkChannel) => {
    const amCreator = (item as any).amCreator === true;
    const isDelete = item.type === "DM" || amCreator;
    const verb = item.type === "CHANNEL" && amCreator ? "삭제" : "나가기";
    const msg = isDelete && item.type === "CHANNEL"
      ? `"${item.name}" 채널을 삭제할까요?\n모든 멤버에게서 사라집니다.`
      : `"${item.name}"에서 나갈까요?`;
    Alert.alert(verb, msg, [
      { text: "취소", style: "cancel" },
      {
        text: verb,
        style: "destructive",
        onPress: async () => {
          try {
            if (isDelete) await deleteChannel(item.id);
            else await leaveChannel(item.id, myId);
            load();
          } catch (e: any) {
            Alert.alert("오류", e?.response?.data?.error || "처리 중 오류가 발생했습니다.");
          }
        },
      },
    ]);
  };

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
      renderItem={({ item }) => (
        <SwipeableChannelRow
          item={item}
          onOpen={() => navigation.navigate("WorkChat", { channelId: item.id, name: item.name, notify: item.notify, type: item.type })}
          onAction={() => handleAction(item)}
        />
      )}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={<Text style={styles.empty}>채널이 없습니다.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 40 },
  swipeWrap: { backgroundColor: "#ef4444" },
  actionBtn: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_W,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  actionDelete: { backgroundColor: "#ef4444" },
  actionLeave: { backgroundColor: "#6b7280" },
  actionText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  rowAnimated: { backgroundColor: "#fff" },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    backgroundColor: "#fff",
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
