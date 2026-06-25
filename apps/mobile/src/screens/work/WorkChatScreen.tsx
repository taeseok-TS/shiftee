import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRoute, RouteProp } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { WorkMessage } from "@shiftee/api";
import * as api from "../../services/api";
import { uploadFile, sendFileMessage, toggleReaction, FILE_ORIGIN } from "../../services/work";

type ParamList = { WorkChat: { channelId: string; name: string } };

const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "👏"];

export default function WorkChatScreen() {
  const route = useRoute<RouteProp<ParamList, "WorkChat">>();
  const { channelId } = route.params;
  const [messages, setMessages] = useState<WorkMessage[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const listRef = useRef<FlatList<WorkMessage>>(null);
  const tabBarHeight = useBottomTabBarHeight();

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

  const handleAttach = async () => {
    if (uploading) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      setUploading(true);
      const uploaded = await uploadFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType });
      const msg = await sendFileMessage(channelId, uploaded);
      setMessages((prev) => [...prev, msg]);
    } catch (error: any) {
      Alert.alert("업로드 실패", error?.response?.data?.error || "파일 전송 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const handlePickImage = async () => {
    if (uploading) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset) return;
      setUploading(true);
      const name = asset.fileName || `photo_${Date.now()}.jpg`;
      const mimeType = asset.mimeType || "image/jpeg";
      const uploaded = await uploadFile({ uri: asset.uri, name, mimeType });
      const msg = await sendFileMessage(channelId, uploaded);
      setMessages((prev) => [...prev, msg]);
    } catch (error: any) {
      Alert.alert("업로드 실패", error?.response?.data?.error || "사진 전송 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const react = async (messageId: string, emoji: string) => {
    try {
      await toggleReaction(messageId, emoji);
      await load();
    } catch (error) {
      console.error("❌ Failed to react:", error);
    }
  };

  const renderItem = ({ item }: { item: WorkMessage }) => {
    const reactions = (item.reactions as any[]) || [];
    return (
      <View style={[styles.row, item.mine ? styles.rowMine : styles.rowOther]}>
        {!item.mine && <Text style={styles.sender}>{item.userName}</Text>}
        <Pressable
          onLongPress={() => setReactionTarget(item.id)}
          style={[styles.bubble, item.mine ? styles.bubbleMine : styles.bubbleOther, item.fileType === "image" && styles.bubbleImage]}
        >
          {item.fileUrl ? (
            item.fileType === "image" ? (
              <TouchableOpacity onPress={() => Linking.openURL(FILE_ORIGIN + item.fileUrl)}>
                <Image source={{ uri: FILE_ORIGIN + item.fileUrl }} style={styles.image} resizeMode="cover" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={() => Linking.openURL(FILE_ORIGIN + item.fileUrl)}>
                <Text style={[styles.msgText, item.mine && styles.msgTextMine]}>📎 {item.fileName || "첨부파일"}</Text>
              </TouchableOpacity>
            )
          ) : (
            <Text style={[styles.msgText, item.mine && styles.msgTextMine]}>{item.content}</Text>
          )}
        </Pressable>

        {reactions.length > 0 && (
          <View style={[styles.reactions, item.mine ? { justifyContent: "flex-end" } : undefined]}>
            {reactions.map((r) => (
              <TouchableOpacity
                key={r.emoji}
                style={[styles.reactionChip, r.mine && styles.reactionChipMine]}
                onPress={() => react(item.id, r.emoji)}
              >
                <Text style={styles.reactionText}>{r.emoji} {r.count}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.time}>
          {new Date(item.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
        </Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={tabBarHeight}
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
        <TouchableOpacity style={styles.attachBtn} onPress={handlePickImage} disabled={uploading}>
          <Ionicons name="image-outline" size={26} color="#4f46e5" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.attachBtn} onPress={handleAttach} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator size="small" color="#4f46e5" />
          ) : (
            <Ionicons name="document-outline" size={24} color="#4f46e5" />
          )}
        </TouchableOpacity>
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

      {/* 리액션 선택 (메시지 길게 누르면 표시) */}
      <Modal visible={!!reactionTarget} transparent animationType="fade" onRequestClose={() => setReactionTarget(null)}>
        <Pressable style={styles.modalBg} onPress={() => setReactionTarget(null)}>
          <View style={styles.emojiBar}>
            {EMOJIS.map((e) => (
              <TouchableOpacity
                key={e}
                onPress={() => {
                  const t = reactionTarget;
                  setReactionTarget(null);
                  if (t) react(t, e);
                }}
              >
                <Text style={styles.emojiBig}>{e}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
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
  bubbleImage: { padding: 4 },
  bubbleMine: { backgroundColor: "#4f46e5", borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: "#fff", borderBottomLeftRadius: 4 },
  msgText: { fontSize: 15, color: "#111827", lineHeight: 20 },
  msgTextMine: { color: "#fff" },
  image: { width: 200, height: 200, borderRadius: 12 },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reactionChipMine: { backgroundColor: "#eef2ff", borderColor: "#c7d2fe" },
  reactionText: { fontSize: 13, color: "#374151" },
  time: { fontSize: 11, color: "#9ca3af", marginTop: 3, marginHorizontal: 4 },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  attachBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
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
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", alignItems: "center" },
  emojiBar: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 30,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  emojiBig: { fontSize: 30 },
});
