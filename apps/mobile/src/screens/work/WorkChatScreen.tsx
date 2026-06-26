import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRoute, RouteProp, useNavigation } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { WorkMessage } from "@shiftee/api";
import * as api from "../../services/api";
import { uploadFile, sendFileMessage, toggleReaction, FILE_ORIGIN } from "../../services/work";
import { getMembers, addChannelMembers, setChannelNotify, getChannelMemberIds, Member } from "../../services/channels";

type ParamList = { WorkChat: { channelId: string; name: string; notify?: string; type?: string } };

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
  const insets = useSafeAreaInsets();
  // iOS는 탭바 높이에 하단 안전영역이 포함돼 이중 계산됨 → 그만큼 더 올림
  const kbOffset = Platform.OS === "ios" ? Math.max(tabBarHeight - insets.bottom, 0) : tabBarHeight;

  const navigation = useNavigation<any>();
  const isGroup = route.params.type !== "DM";
  const [notify, setNotify] = useState(route.params.notify ?? "ALL");
  // 멤버 추가 모달
  const [addOpen, setAddOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [selectedNew, setSelectedNew] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const addCandidates = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return members.filter((m) => !existingIds.has(m.id) && (!q || m.name.toLowerCase().includes(q)));
  }, [members, existingIds, memberSearch]);

  // #4 알림 켜기/끄기 (ALL ↔ MUTE)
  const toggleNotify = async () => {
    const next = notify === "MUTE" ? "ALL" : "MUTE";
    setNotify(next);
    try {
      await setChannelNotify(channelId, next as any);
    } catch {
      setNotify(notify); // 실패 시 복원
    }
  };

  // #5 멤버 추가
  const openAddMembers = async () => {
    setSelectedNew(new Set());
    setMemberSearch("");
    setAddOpen(true);
    try {
      const [all, existing] = await Promise.all([getMembers(), getChannelMemberIds(channelId)]);
      setMembers(all);
      setExistingIds(new Set(existing));
    } catch {
      Alert.alert("오류", "직원 목록을 불러오지 못했습니다.");
    }
  };

  const confirmAddMembers = async () => {
    const ids = Array.from(selectedNew);
    if (!ids.length) {
      setAddOpen(false);
      return;
    }
    setAddLoading(true);
    try {
      await addChannelMembers(channelId, ids);
      setAddOpen(false);
      Alert.alert("완료", `${ids.length}명을 초대했습니다.`);
      load();
    } catch (e: any) {
      Alert.alert("실패", e?.response?.data?.error || "멤버 추가 중 오류가 발생했습니다.");
    } finally {
      setAddLoading(false);
    }
  };

  // 헤더 우측: 알림 토글 + (그룹 채널만) 멤버 추가
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: "row", gap: 16, marginRight: 4 }}>
          <TouchableOpacity onPress={toggleNotify}>
            <Ionicons
              name={notify === "MUTE" ? "notifications-off-outline" : "notifications-outline"}
              size={22}
              color={notify === "MUTE" ? "#9ca3af" : "#4f46e5"}
            />
          </TouchableOpacity>
          {isGroup && (
            <TouchableOpacity onPress={openAddMembers}>
              <Ionicons name="person-add-outline" size={22} color="#4f46e5" />
            </TouchableOpacity>
          )}
        </View>
      ),
    });
  }, [navigation, notify, isGroup]);

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

  // 업로드 + 메시지 전송 (단일 파일)
  const uploadAndSend = async (file: { uri: string; name: string; mimeType?: string | null }) => {
    const uploaded = await uploadFile(file);
    const msg = await sendFileMessage(channelId, uploaded);
    setMessages((prev) => [...prev, msg]);
  };

  // 파일(문서) 첨부 — 다중 선택
  const handleAttach = async () => {
    if (uploading) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (result.canceled) return;
      const assets = result.assets ?? [];
      if (!assets.length) return;
      setUploading(true);
      for (const a of assets) {
        await uploadAndSend({ uri: a.uri, name: a.name, mimeType: a.mimeType });
      }
    } catch (error: any) {
      Alert.alert("업로드 실패", error?.response?.data?.error || error?.message || "파일 전송 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  };

  // 사진 첨부 — 갤러리 다중 선택
  const handlePickImage = async () => {
    if (uploading) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        quality: 0.8,
      });
      if (result.canceled) return;
      const assets = result.assets ?? [];
      if (!assets.length) return;
      setUploading(true);
      for (let i = 0; i < assets.length; i++) {
        const a = assets[i];
        const name = a.fileName || `photo_${Date.now()}_${i}.jpg`;
        await uploadAndSend({ uri: a.uri, name, mimeType: a.mimeType || "image/jpeg" });
      }
    } catch (error: any) {
      Alert.alert("업로드 실패", error?.response?.data?.error || error?.message || "사진 전송 중 오류가 발생했습니다.");
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
      keyboardVerticalOffset={kbOffset}
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

      {/* #5 멤버 추가 모달 */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <View style={styles.addBg}>
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>멤버 추가</Text>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color="#9ca3af" />
              <TextInput style={styles.searchInput} placeholder="이름 검색" value={memberSearch} onChangeText={setMemberSearch} />
            </View>
            <FlatList
              style={{ maxHeight: 320 }}
              data={addCandidates}
              keyExtractor={(m) => m.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.addEmpty}>추가할 직원이 없습니다.</Text>}
              renderItem={({ item }) => {
                const on = selectedNew.has(item.id);
                return (
                  <TouchableOpacity
                    style={styles.addRow}
                    onPress={() =>
                      setSelectedNew((p) => {
                        const n = new Set(p);
                        n.has(item.id) ? n.delete(item.id) : n.add(item.id);
                        return n;
                      })
                    }
                  >
                    <View style={[styles.addCheck, on && styles.addCheckOn]}>
                      {on && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                    <Text style={styles.addName}>
                      {item.branch ? `[${item.branch}] ` : ""}{item.name}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
            <View style={styles.addBtns}>
              <TouchableOpacity style={styles.addCancel} onPress={() => setAddOpen(false)}>
                <Text style={styles.addCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addConfirm, selectedNew.size === 0 && { opacity: 0.5 }]}
                disabled={selectedNew.size === 0 || addLoading}
                onPress={confirmAddMembers}
              >
                {addLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addConfirmText}>{selectedNew.size > 0 ? `${selectedNew.size}명 추가` : "추가"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
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
  addBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  addCard: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 28 },
  addTitle: { fontSize: 17, fontWeight: "bold", color: "#111827", marginBottom: 12 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 40, borderRadius: 8, backgroundColor: "#f3f4f6", marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14 },
  addEmpty: { textAlign: "center", color: "#9ca3af", paddingVertical: 24 },
  addRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  addCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center", marginRight: 12 },
  addCheckOn: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  addName: { fontSize: 15, color: "#111827" },
  addBtns: { flexDirection: "row", gap: 8, marginTop: 14 },
  addCancel: { flex: 1, height: 46, borderRadius: 10, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  addCancelText: { fontSize: 15, color: "#374151", fontWeight: "600" },
  addConfirm: { flex: 1, height: 46, borderRadius: 10, backgroundColor: "#4f46e5", alignItems: "center", justifyContent: "center" },
  addConfirmText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
