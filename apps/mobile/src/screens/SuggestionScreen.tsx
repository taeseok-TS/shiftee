import React, { useState, useEffect, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Image, Alert, ActivityIndicator, RefreshControl, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { uploadFile, getMySuggestions, createSuggestion, updateSuggestion, SuggestionItem, FILE_ORIGIN } from "../services/work";

// 개선 제안함 — 작성자와 관리자만 보는 비공개 창구. 처리 상태는 봇 DM으로도 통지된다.

const STATUS_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  RECEIVED: { label: "접수", bg: "#f3f4f6", fg: "#4b5563" },
  REVIEWING: { label: "검토중", bg: "#dbeafe", fg: "#1d4ed8" },
  PLANNED: { label: "반영 예정", bg: "#e0e7ff", fg: "#4338ca" },
  DONE: { label: "완료", bg: "#dcfce7", fg: "#15803d" },
  HOLD: { label: "보류", bg: "#fef3c7", fg: "#b45309" },
};

export default function SuggestionScreen() {
  const [list, setList] = useState<SuggestionItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setList(await getMySuggestions()); } catch { setList([]); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // 작성·수정 폼 공용 픽커 — current/setFn 으로 어느 이미지 목록에 붙일지 정한다 (#138)
  const pickImageTo = async (current: string[], setFn: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (uploading || current.length >= 5) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true, quality: 0.8 });
      if (result.canceled) return;
      setUploading(true);
      const now = Date.now();
      for (const [i, a] of (result.assets ?? []).entries()) {
        if (current.length + i >= 5) break;
        const up = await uploadFile({ uri: a.uri, name: a.fileName || `suggest_${now}_${i}.jpg`, mimeType: a.mimeType || "image/jpeg" });
        setFn((prev) => [...prev, up.fileUrl].slice(0, 5));
      }
    } catch (e: any) {
      Alert.alert("첨부 실패", e?.message || "이미지 업로드 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  };
  const pickImage = () => pickImageTo(images, setImages);

  // 접수 상태인 내 제안 인라인 수정 (디렉터 지시 2026-08-24)
  // 이미지'만' 추가하는 수정은 검토중·반영예정에서도 가능 — 담당자 추가 캡처 요청 대응 (#138)
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editImages, setEditImages] = useState<string[]>([]);
  const [editSaving, setEditSaving] = useState(false);

  const saveEdit = async () => {
    if (!editId || editSaving) return;
    if (!editTitle.trim() || !editContent.trim()) { Alert.alert("알림", "제목과 내용을 입력해주세요."); return; }
    setEditSaving(true);
    try {
      await updateSuggestion(editId, { title: editTitle.trim(), content: editContent.trim(), imageUrls: editImages });
      setEditId(null);
      load();
    } catch (e: any) {
      Alert.alert("수정 실패", e?.response?.data?.error || "제안 수정 중 오류가 발생했습니다.");
    } finally {
      setEditSaving(false);
    }
  };

  const submit = async () => {
    if (!title.trim() || !content.trim()) { Alert.alert("알림", "제목과 내용을 입력해주세요."); return; }
    if (saving || uploading) return;
    setSaving(true);
    try {
      await createSuggestion({ title: title.trim(), content: content.trim(), imageUrls: images });
      setTitle(""); setContent(""); setImages([]);
      Alert.alert("접수 완료", "제안이 접수되었습니다.\n처리 현황은 이 화면과 큐브티 봇 알림으로 알려드립니다.");
      load();
    } catch (e: any) {
      Alert.alert("등록 실패", e?.response?.data?.error || "제안 등록 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView
        style={styles.container}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.intro}>
          큐브티를 쓰다가 불편한 점, 있었으면 하는 기능을 편하게 남겨주세요.{"\n"}
          <Text style={styles.introStrong}>작성자와 관리자만 볼 수 있습니다.</Text>
        </Text>

        {/* 작성 */}
        <View style={styles.card}>
          <TextInput style={styles.titleInput} placeholder="제목" value={title} onChangeText={setTitle} maxLength={100} />
          <TextInput
            style={styles.contentInput}
            placeholder="내용 — 어떤 화면에서, 어떤 점이 불편했는지 적어주시면 반영이 빨라집니다."
            value={content}
            onChangeText={setContent}
            multiline
          />
          <View style={styles.attachRow}>
            <TouchableOpacity style={styles.attachBtn} onPress={pickImage} disabled={uploading || images.length >= 5}>
              {uploading ? <ActivityIndicator size="small" color="#4f46e5" /> : <Ionicons name="image-outline" size={18} color="#4f46e5" />}
              <Text style={styles.attachBtnText}>스크린샷 첨부</Text>
            </TouchableOpacity>
            <Text style={styles.attachHint}>최대 5장</Text>
          </View>
          {images.length > 0 && (
            <View style={styles.thumbRow}>
              {images.map((u, i) => (
                <View key={`${u}-${i}`} style={styles.thumbWrap}>
                  <Image source={{ uri: FILE_ORIGIN + u }} style={styles.thumb} />
                  <TouchableOpacity style={styles.thumbRemove} onPress={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                    <Ionicons name="close" size={12} color="#fff" />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
          <TouchableOpacity style={[styles.submitBtn, (saving || uploading) && styles.submitBtnDisabled]} onPress={submit} disabled={saving || uploading}>
            <Text style={styles.submitText}>{saving ? "등록 중..." : "제안 등록"}</Text>
          </TouchableOpacity>
        </View>

        {/* 내 제안 목록 */}
        <Text style={styles.sectionTitle}>내 제안{list && list.length > 0 ? ` (${list.length})` : ""}</Text>
        {!list ? (
          <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
        ) : list.length === 0 ? (
          <Text style={styles.empty}>아직 등록한 제안이 없습니다.</Text>
        ) : (
          list.map((s) => {
            const badge = STATUS_BADGE[s.status] || STATUS_BADGE.RECEIVED;
            return (
              <View key={s.id} style={styles.card}>
                <View style={styles.itemHead}>
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.badgeText, { color: badge.fg }]}>{badge.label}</Text>
                  </View>
                  <Text style={styles.itemTitle} numberOfLines={1}>{s.seqNo ? `#${s.seqNo} ` : ""}{s.title}</Text>
                  {/* 검토 전(접수)엔 전체 수정, 검토중·반영예정엔 이미지 추가만 가능 (#138) */}
                  {["RECEIVED", "REVIEWING", "PLANNED"].includes(s.status) && editId !== s.id && (
                    <TouchableOpacity onPress={() => { setEditId(s.id); setEditTitle(s.title); setEditContent(s.content); setEditImages(s.imageUrls || []); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="pencil" size={14} color="#9ca3af" />
                    </TouchableOpacity>
                  )}
                  <Text style={styles.itemDate}>{new Date(s.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</Text>
                </View>
                {editId === s.id ? (
                  <View style={{ marginTop: 8 }}>
                    {/* 검토 시작 후에는 글은 잠그고 이미지만 추가 가능 (#138) */}
                    <TextInput style={styles.titleInput} value={editTitle} onChangeText={setEditTitle} maxLength={100}
                      editable={s.status === "RECEIVED"} />
                    <TextInput style={styles.contentInput} value={editContent} onChangeText={setEditContent} multiline
                      editable={s.status === "RECEIVED"} />
                    {editImages.length > 0 && (
                      <View style={styles.thumbRow}>
                        {editImages.map((u, i) => (
                          <View key={`${u}-${i}`} style={styles.thumbWrap}>
                            <Image source={{ uri: FILE_ORIGIN + u }} style={styles.thumb} />
                            <TouchableOpacity style={styles.thumbRemove} onPress={() => setEditImages((prev) => prev.filter((_, idx) => idx !== i))}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                              <Ionicons name="close" size={12} color="#fff" />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    )}
                    <View style={styles.attachRow}>
                      <TouchableOpacity style={styles.attachBtn} onPress={() => pickImageTo(editImages, setEditImages)} disabled={uploading || editImages.length >= 5}>
                        {uploading ? <ActivityIndicator size="small" color="#4f46e5" /> : <Ionicons name="image-outline" size={18} color="#4f46e5" />}
                        <Text style={styles.attachBtnText}>스크린샷 추가</Text>
                      </TouchableOpacity>
                      <Text style={styles.attachHint}>최대 5장</Text>
                    </View>
                    <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
                      <TouchableOpacity style={styles.editCancelBtn} onPress={() => setEditId(null)}>
                        <Text style={{ color: "#6b7280", fontSize: 13 }}>취소</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.submitBtn, { marginTop: 0, paddingVertical: 8, paddingHorizontal: 14 }, (editSaving || uploading) && styles.submitBtnDisabled]}
                        onPress={saveEdit} disabled={editSaving || uploading}>
                        <Text style={styles.submitText}>{editSaving ? "저장 중..." : "수정 저장"}</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                <Text style={styles.itemContent}>{s.content}</Text>
                )}
                {editId !== s.id && (s.imageUrls?.length ?? 0) > 0 && (
                  <View style={styles.thumbRow}>
                    {s.imageUrls!.map((u, i) => (
                      <Image key={i} source={{ uri: FILE_ORIGIN + u }} style={styles.thumb} />
                    ))}
                  </View>
                )}
                {s.adminComment ? (
                  <View style={styles.commentBox}>
                    <Text style={styles.commentLabel}>관리자 답변</Text>
                    <Text style={styles.commentText}>{s.adminComment}</Text>
                  </View>
                ) : null}
              </View>
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6", padding: 14 },
  intro: { fontSize: 13, color: "#6b7280", lineHeight: 19, marginBottom: 12 },
  introStrong: { fontWeight: "700", color: "#4b5563" },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 12 },
  titleInput: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: "#111827" },
  contentInput: {
    borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, minHeight: 110, textAlignVertical: "top", marginTop: 8, color: "#111827",
  },
  attachRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  attachBtn: {
    flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#c7d2fe",
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: "#eef2ff",
  },
  attachBtnText: { fontSize: 13, color: "#4f46e5", fontWeight: "600" },
  attachHint: { fontSize: 11, color: "#9ca3af" },
  thumbRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 },
  thumbWrap: { position: "relative" },
  thumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: "#f3f4f6" },
  thumbRemove: {
    position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: 9,
    backgroundColor: "#374151", alignItems: "center", justifyContent: "center",
  },
  submitBtn: { backgroundColor: "#4f46e5", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  editCancelBtn: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 14, alignItems: "center", justifyContent: "center" },
  submitBtnDisabled: { backgroundColor: "#c7d2fe" },
  submitText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#374151", marginBottom: 8, marginTop: 4 },
  empty: { textAlign: "center", color: "#9ca3af", fontSize: 13, paddingVertical: 24 },
  itemHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  itemTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: "#111827" },
  itemDate: { fontSize: 11, color: "#9ca3af" },
  itemContent: { fontSize: 13, color: "#4b5563", marginTop: 8, lineHeight: 19 },
  commentBox: { backgroundColor: "#eef2ff", borderRadius: 8, padding: 10, marginTop: 10 },
  commentLabel: { fontSize: 11, fontWeight: "700", color: "#4338ca", marginBottom: 3 },
  commentText: { fontSize: 13, color: "#3730a3", lineHeight: 19 },
});
