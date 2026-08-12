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
  KeyboardAvoidingView,
  Platform,
  Image,
  Linking,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { Announcement } from "@shiftee/api";
import * as api from "../../services/api";
import * as storage from "../../services/storage";
import { createAnnouncement, pinAnnouncement, deleteAnnouncement, uploadFile, FILE_ORIGIN } from "../../services/work";

type Attachment = { url: string; name: string; type: string };

// 본문 속 URL을 눌러서 열 수 있게 링크화
export function linkifyText(text: string) {
  const parts = text.split(/(https?:\/\/[^\s<>")\]]+)/g);
  return parts.map((p, i) =>
    /^https?:\/\//.test(p)
      ? <Text key={i} style={{ color: "#4f46e5", textDecorationLine: "underline" }} onPress={() => Linking.openURL(p)}>{p}</Text>
      : <Text key={i}>{p}</Text>
  );
}

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
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);

  // 첨부: 이미지(갤러리 다중) / 파일
  const pickImages = async () => {
    if (uploading) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.8 });
      if (result.canceled || !result.assets?.length) return;
      setUploading(true);
      for (let i = 0; i < result.assets.length; i++) {
        const a = result.assets[i];
        const name = a.fileName || `photo_${Date.now()}_${i}.jpg`;
        const up = await uploadFile({ uri: a.uri, name, mimeType: a.mimeType || "image/jpeg" });
        setAtts((prev) => [...prev, { url: up.fileUrl, name: up.fileName, type: up.fileType }]);
      }
    } catch (e: any) {
      Alert.alert("업로드 실패", e?.message || "사진 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  };

  const pickFiles = async () => {
    if (uploading) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (result.canceled || !result.assets?.length) return;
      setUploading(true);
      for (const a of result.assets) {
        const up = await uploadFile({ uri: a.uri, name: a.name, mimeType: a.mimeType });
        setAtts((prev) => [...prev, { url: up.fileUrl, name: up.fileName, type: up.fileType }]);
      }
    } catch (e: any) {
      Alert.alert("업로드 실패", e?.message || "파일 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  };

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

  // 핀 고정/해제 (관리자)
  const onTogglePin = async (a: Announcement) => {
    try {
      await pinAnnouncement(a.id, !a.pinned);
      load();
    } catch (e: any) {
      Alert.alert("실패", e?.response?.data?.error || "변경 중 오류가 발생했습니다.");
    }
  };

  // 삭제 (관리자)
  const onDelete = (a: Announcement) => {
    Alert.alert("공지 삭제", `"${a.title}" 공지를 삭제할까요?`, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteAnnouncement(a.id);
            load();
          } catch (e: any) {
            Alert.alert("실패", e?.response?.data?.error || "삭제 중 오류가 발생했습니다.");
          }
        },
      },
    ]);
  };

  // 관리자만 헤더에 작성 버튼
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        isAdmin ? (
          // iOS 26 글래스 원형 안에서 가운데 정렬되도록 비대칭 margin 금지
          <TouchableOpacity onPress={() => setCreateOpen(true)} style={{ alignItems: "center", justifyContent: "center" }}>
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
      await createAnnouncement({ title: title.trim(), content: content.trim(), pinned, attachments: atts });
      setCreateOpen(false);
      setTitle("");
      setContent("");
      setPinned(false);
      setAtts([]);
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
              {isAdmin && (
                <View style={styles.adminBtns}>
                  <TouchableOpacity onPress={() => onTogglePin(item)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                    <Ionicons name={item.pinned ? "pin" : "pin-outline"} size={18} color={item.pinned ? "#4f46e5" : "#9ca3af"} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onDelete(item)} hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}>
                    <Ionicons name="trash-outline" size={17} color="#ef4444" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
            <Text style={styles.content}>{linkifyText(item.content)}</Text>
            {(item.attachments?.length ?? 0) > 0 && (
              <View style={styles.attList}>
                {item.attachments.map((att, i) =>
                  att.type === "image" ? (
                    <TouchableOpacity key={i} onPress={() => Linking.openURL(FILE_ORIGIN + att.url)}>
                      <Image source={{ uri: FILE_ORIGIN + att.url }} style={styles.attImage} resizeMode="cover" />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity key={i} style={styles.attFile} onPress={() => Linking.openURL(FILE_ORIGIN + att.url)}>
                      <Ionicons name="attach" size={14} color="#4f46e5" />
                      <Text style={styles.attFileName} numberOfLines={1}>{att.name}</Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            )}
            <Text style={styles.meta}>
              {item.authorName} · {new Date(item.createdAt).toLocaleDateString("ko-KR")}
            </Text>
          </View>
        )}
      />

      {/* 공지 작성 모달 (관리자) */}
      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === "ios" ? "padding" : undefined}>
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
            {/* 이미지/파일 첨부 */}
            <View style={styles.attachRow}>
              <TouchableOpacity style={styles.attachBtn} onPress={pickImages} disabled={uploading}>
                <Ionicons name="image-outline" size={18} color="#4f46e5" />
                <Text style={styles.attachBtnText}>이미지</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.attachBtn} onPress={pickFiles} disabled={uploading}>
                {uploading ? (
                  <ActivityIndicator size="small" color="#4f46e5" />
                ) : (
                  <Ionicons name="document-outline" size={17} color="#4f46e5" />
                )}
                <Text style={styles.attachBtnText}>파일</Text>
              </TouchableOpacity>
            </View>
            {atts.length > 0 && (
              <View style={styles.attChips}>
                {atts.map((a, i) => (
                  <View key={i} style={styles.attChip}>
                    <Ionicons name={a.type === "image" ? "image" : "document"} size={13} color="#4f46e5" />
                    <Text style={styles.attChipText} numberOfLines={1}>{a.name}</Text>
                    <TouchableOpacity onPress={() => setAtts((prev) => prev.filter((_, idx) => idx !== i))}>
                      <Ionicons name="close-circle" size={16} color="#9ca3af" />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
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
              <TouchableOpacity style={styles.submitBtn} disabled={posting || uploading} onPress={submit}>
                {posting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.submitText}>등록</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  adminBtns: { flexDirection: "row", alignItems: "center", gap: 14, marginLeft: 8 },
  title: { fontSize: 16, fontWeight: "bold", color: "#111827", flex: 1 },
  content: { fontSize: 14, color: "#374151", lineHeight: 20 },
  meta: { fontSize: 12, color: "#9ca3af", marginTop: 10 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  modalCard: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 28 },
  modalTitle: { fontSize: 17, fontWeight: "bold", color: "#111827", marginBottom: 14 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 10, color: "#111827" },
  textArea: { minHeight: 110, textAlignVertical: "top" },
  attachRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  attachBtn: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "#e0e7ff", backgroundColor: "#eef2ff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  attachBtnText: { fontSize: 13, color: "#4f46e5", fontWeight: "600" },
  attChips: { gap: 6, marginBottom: 8 },
  attChip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#f9fafb", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  attChipText: { flex: 1, fontSize: 13, color: "#374151" },
  attList: { marginTop: 10, gap: 8 },
  attImage: { width: "100%", height: 160, borderRadius: 10, backgroundColor: "#f3f4f6" },
  attFile: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, alignSelf: "flex-start" },
  attFileName: { fontSize: 13, color: "#4f46e5", textDecorationLine: "underline", maxWidth: 240 },
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
