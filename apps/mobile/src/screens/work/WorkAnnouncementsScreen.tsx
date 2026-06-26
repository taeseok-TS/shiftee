import React, { useCallback, useEffect, useLayoutEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { Announcement } from "@shiftee/api";
import * as api from "../../services/api";
import * as storage from "../../services/storage";
import { createAnnouncement } from "../../services/work";

export default function WorkAnnouncementsScreen() {
  const navigation = useNavigation<any>();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [pinned, setPinned] = useState(false);
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    storage.getUser().then((u) => setIsAdmin(u?.role === "ADMIN")).catch(() => {});
  }, []);

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

  // 관리자만 헤더에 작성 버튼
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        isAdmin ? (
          <TouchableOpacity onPress={() => setCreateOpen(true)} style={{ marginRight: 4 }}>
            <Ionicons name="create-outline" size={22} color="#4f46e5" />
          </TouchableOpacity>
        ) : null,
    });
  }, [navigation, isAdmin]);

  const submit = async () => {
    if (!title.trim() || !content.trim()) {
      Alert.alert("알림", "제목과 내용을 입력해주세요.");
      return;
    }
    setPosting(true);
    try {
      await createAnnouncement({ title: title.trim(), content: content.trim(), pinned });
      setCreateOpen(false);
      setTitle("");
      setContent("");
      setPinned(false);
      load();
    } catch (e: any) {
      Alert.alert("작성 실패", e?.response?.data?.error || "공지 작성 중 오류가 발생했습니다.");
    } finally {
      setPosting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
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

      {/* 공지 작성 모달 (관리자) */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBg}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>공지 작성</Text>
            <TextInput
              style={styles.input}
              placeholder="제목"
              value={title}
              onChangeText={setTitle}
            />
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="내용"
              value={content}
              onChangeText={setContent}
              multiline
            />
            <TouchableOpacity style={styles.pinRow} onPress={() => setPinned((p) => !p)}>
              <View style={[styles.pinBox, pinned && styles.pinBoxOn]}>
                {pinned && <Ionicons name="checkmark" size={14} color="#fff" />}
              </View>
              <Text style={styles.pinLabel}>상단 고정</Text>
            </TouchableOpacity>
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setCreateOpen(false)}>
                <Text style={styles.cancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.submitBtn} disabled={posting} onPress={submit}>
                {posting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitText}>등록</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
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
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 28 },
  modalTitle: { fontSize: 17, fontWeight: "bold", color: "#111827", marginBottom: 14 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10 },
  textArea: { minHeight: 110, textAlignVertical: "top" },
  pinRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  pinBox: { width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center", marginRight: 8 },
  pinBoxOn: { backgroundColor: "#ef4444", borderColor: "#ef4444" },
  pinLabel: { fontSize: 14, color: "#374151" },
  modalBtns: { flexDirection: "row", gap: 8, marginTop: 16 },
  cancelBtn: { flex: 1, height: 48, borderRadius: 10, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  cancelText: { fontSize: 15, color: "#374151", fontWeight: "600" },
  submitBtn: { flex: 1, height: 48, borderRadius: 10, backgroundColor: "#4f46e5", alignItems: "center", justifyContent: "center" },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
