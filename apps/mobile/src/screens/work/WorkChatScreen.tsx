import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRoute, RouteProp } from "@react-navigation/native";
import { WorkMessage } from "@shiftee/api";
import * as api from "../../services/api";

type ParamList = { WorkChat: { channelId: string; name: string } };

export default function WorkChatScreen() {
  const route = useRoute<RouteProp<ParamList, "WorkChat">>();
  const { channelId } = route.params;
  const [messages, setMessages] = useState<WorkMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<WorkMessage>>(null);

  const load = useCallback(async () => {
    try {
      const m = await api.getMessages(channelId);
      setMessages(m);
    } catch (error) {
      console.error("❌ Failed to load messages:", error);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    load();
    api.markChannelRead(channelId).catch(() => {});
    // 간단한 실시간: 4초마다 폴링
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [load, channelId]);

  const handleSend = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setText("");
    try {
      const msg = await api.sendMessage(channelId, content);
      setMessages((prev) => [...prev, msg]);
    } catch (error) {
      console.error("❌ Failed to send:", error);
      setText(content); // 실패 시 입력 복원
    } finally {
      setSending(false);
    }
  };

  const renderItem = ({ item }: { item: WorkMessage }) => (
    <View style={[styles.row, item.mine ? styles.rowMine : styles.rowOther]}>
      {!item.mine && <Text style={styles.sender}>{item.userName}</Text>}
      <View style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleOther]}>
        {item.fileUrl && !item.content ? (
          <Text style={[styles.msgText, item.mine && styles.msgTextMine]}>📎 {item.fileName || "첨부파일"}</Text>
        ) : (
          <Text style={[styles.msgText, item.mine && styles.msgTextMine]}>{item.content}</Text>
        )}
      </View>
      <Text style={styles.time}>
        {new Date(item.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
      </Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={90}
    >
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={<Text style={styles.empty}>첫 메시지를 보내보세요.</Text>}
        />
      )}

      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="메시지 입력..."
          value={text}
          onChangeText={setText}
          multiline
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!text.trim() || sending}
        >
          <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 40 },
  listContent: { padding: 12 },
  row: { marginBottom: 12, maxWidth: "80%" },
  rowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  rowOther: { alignSelf: "flex-start", alignItems: "flex-start" },
  sender: { fontSize: 12, color: "#6b7280", marginBottom: 2, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16 },
  bubbleMine: { backgroundColor: "#4f46e5", borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: "#fff", borderBottomLeftRadius: 4 },
  msgText: { fontSize: 15, color: "#111827", lineHeight: 20 },
  msgTextMine: { color: "#fff" },
  time: { fontSize: 11, color: "#9ca3af", marginTop: 3, marginHorizontal: 4 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    maxHeight: 100,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    fontSize: 15,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#4f46e5",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: "#c7d2fe" },
});
