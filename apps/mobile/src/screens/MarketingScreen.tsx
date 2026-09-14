import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator, RefreshControl,
  Modal, Linking, KeyboardAvoidingView, Platform, Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { fileUri } from "../services/work";
import { getUser } from "../services/storage";
import { Category, Submission, SubmissionFile, createSubmission, deleteSubmission, getCategories, getMarketing, uploadSubmissionFile } from "../services/submissions";

// 마케팅 자료 (2026-09-14 큐브마케팅 연동 ②) — 웹 /work/marketing 과 같은 화면.
//  지점이 수업·행사 사례, 성적 향상 사례, 지점 사진, 후기를 올리면 큐브마케팅이 가져가 블로그에 발행하고 주소를 되돌려준다("블로그 발행됨").
//  검수는 큐브마케팅 쪽. 여기서는 개인정보 동의 체크만 받는다(서버가 필수로 검사).
//  사진은 사진첩(여러 장)·카메라에서 원본 그대로(아이폰 HEIC 포함 — 변환은 큐브마케팅이 한다) 올린다.

const ALLOWED_EXT = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf", ".hwp", ".hwpx", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".heic", ".heif", ".zip"];
const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".gif", ".webp"]; // 앱이 그릴 수 있는 사진(HEIC 는 못 그린다 — 배지로만)
const PREVIEW_EXT = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf"];
const MAX_FILES = 10;
const MAX_BYTES = 50 * 1024 * 1024;
const extOf = (n: string) => { const m = /\.[^./\\]+$/.exec(n || ""); return m ? m[0].toLowerCase() : ""; };
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);
const TYPE_BADGE: Record<string, string> = { word: "#2b579a", excel: "#217346", ppt: "#d24726", pdf: "#b91c1c", hwp: "#0369a1", image: "#6b7280", zip: "#374151", file: "#6b7280" };
const TYPE_LABEL: Record<string, string> = { word: "W", excel: "X", ppt: "P", pdf: "PDF", hwp: "한", image: "IMG", zip: "ZIP", file: "F" };
const FILE_ORIGIN_VIEWER = (url: string, name: string) => `${url.split("/api/")[0]}/docs/viewer?src=${encodeURIComponent(url)}&title=${encodeURIComponent(name.replace(/\.[^.]+$/, ""))}`;

function openFile(f: SubmissionFile) {
  const ext = extOf(f.name);
  const url = fileUri(f.url);
  const target = PREVIEW_EXT.includes(ext) ? FILE_ORIGIN_VIEWER(url, f.name) : IMAGE_EXT.includes(ext) ? url : url + (url.includes("?") ? "&" : "?") + "download=1";
  Linking.openURL(target).catch(() => Alert.alert("열기 실패", "브라우저를 열 수 없습니다."));
}

function FileRow({ f, onRemove }: { f: SubmissionFile; onRemove?: () => void }) {
  const ext = extOf(f.name);
  const label = ext === ".heic" || ext === ".heif" ? "HEIC" : TYPE_LABEL[f.type] || "F";
  return (
    <View style={styles.fileRow}>
      <View style={[styles.typeBadge, { backgroundColor: TYPE_BADGE[f.type] || TYPE_BADGE.file }]}><Text style={styles.typeBadgeText}>{label}</Text></View>
      <TouchableOpacity style={{ flex: 1 }} onPress={() => openFile(f)} disabled={!!onRemove}>
        <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
        <Text style={styles.fileSize}>{fmtBytes(f.size)}{label === "HEIC" ? " · 아이폰 원본(미리보기 없음)" : ""}</Text>
      </TouchableOpacity>
      {onRemove ? (
        <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="close-circle" size={20} color="#9ca3af" /></TouchableOpacity>
      ) : (
        <Ionicons name="open-outline" size={16} color="#9ca3af" />
      )}
    </View>
  );
}

type Scope = "mine" | "branch" | "all";

export default function MarketingScreen() {
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [scope, setScope] = useState<Scope>("mine");
  const [categories, setCategories] = useState<Category[]>([]);
  const [rows, setRows] = useState<Submission[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => { getUser().then((u) => setMe(u ? { id: u.id, role: u.role } : null)); }, []);
  const load = useCallback(async (sc: Scope) => {
    const [c, r] = await Promise.allSettled([getCategories(), getMarketing(sc)]);
    if (c.status === "fulfilled") setCategories(c.value.filter((x) => x.group === "MARKETING"));
    setRows(r.status === "fulfilled" ? r.value : []);
    setLoadError(c.status === "rejected" || r.status === "rejected"); // 실패를 "없습니다" 로 위장하지 않는다
  }, []);
  useEffect(() => { setRows(null); load(scope); }, [scope, load]);
  const onRefresh = async () => { setRefreshing(true); await load(scope); setRefreshing(false); };

  const remove = (s: Submission) => {
    // 서버 규칙과 같게: 발행된 자료는 본부만 지운다(앱에서는 본부 화면을 두지 않으므로 발행 전만)
    Alert.alert("자료 삭제", `「${s.title}」 을(를) 지울까요?`, [
      { text: "취소", style: "cancel" },
      { text: "지우기", style: "destructive", onPress: async () => {
        try { await deleteSubmission(s.id); load(scope); }
        catch (e: any) { Alert.alert("삭제 실패", e?.response?.data?.error || "지우지 못했습니다."); }
      } },
    ]);
  };

  const scopes: [Scope, string][] = [["mine", "내 자료"], ...(me?.role === "MANAGER" ? [["branch", "우리 지점"] as [Scope, string]] : []), ...(me?.role === "ADMIN" ? [["all", "전체"] as [Scope, string]] : [])];

  return (
    <View style={{ flex: 1, backgroundColor: "#f3f4f6" }}>
      {scopes.length > 1 && (
        <View style={styles.tabBar}>
          {scopes.map(([k, label]) => (
            <TouchableOpacity key={k} style={[styles.tabBtn, scope === k && styles.tabBtnOn]} onPress={() => setScope(k)}>
              <Text style={[styles.tabText, scope === k && styles.tabTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <Text style={styles.intro}>수업·행사 사례, 성적 향상 사례, 지점 사진, 학부모 후기를 올려주세요. 큐브마케팅이 가져가 블로그에 발행하고, 발행되면 여기와 봇 DM 으로 주소를 알려드립니다.</Text>
        {loadError && (
          <View style={styles.errorBox}><Ionicons name="cloud-offline-outline" size={16} color="#b45309" /><Text style={styles.errorText}>목록을 불러오지 못했습니다. 연결을 확인하고 아래로 당겨 새로고침해주세요.</Text></View>
        )}
        {!rows ? <ActivityIndicator color="#db2777" style={{ marginVertical: 24 }} />
        : rows.length === 0 ? <Text style={styles.empty}>{scope === "mine" ? "아직 올린 마케팅 자료가 없습니다." : "올라온 마케팅 자료가 없습니다."}</Text>
        : rows.map((s) => {
          const isOwner = !!me && s.userId === me.id;
          const images = s.files.filter((f) => IMAGE_EXT.includes(extOf(f.name)));
          const others = s.files.filter((f) => !IMAGE_EXT.includes(extOf(f.name)));
          const canDelete = isOwner && !s.publishedAt;
          return (
            <View key={s.id} style={styles.card}>
              <View style={styles.itemHead}>
                <Text style={[styles.itemTitle, { flex: 1 }]} numberOfLines={2}>{s.title}</Text>
                {canDelete && <TouchableOpacity onPress={() => remove(s)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="trash-outline" size={18} color="#9ca3af" /></TouchableOpacity>}
              </View>
              <Text style={styles.itemMeta}>
                {!isOwner ? <Text>{[s.userBranch, s.userJobGroup].filter(Boolean).join(" · ")} <Text style={{ color: "#111827", fontWeight: "700" }}>{s.userName}</Text> · </Text> : null}
                {s.category?.name} · {new Date(s.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}
              </Text>
              <View style={[styles.itemFoot, { marginBottom: 4 }]}>
                {s.publishedAt ? (
                  <TouchableOpacity style={[styles.badge, { backgroundColor: "#dcfce7", flexDirection: "row", alignItems: "center", gap: 4 }]} onPress={() => s.publishedUrl && Linking.openURL(s.publishedUrl).catch(() => {})}>
                    <Ionicons name="checkmark-circle" size={12} color="#15803d" /><Text style={[styles.badgeText, { color: "#15803d" }]}>블로그 발행됨 {new Date(s.publishedAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })}</Text><Ionicons name="open-outline" size={11} color="#15803d" />
                  </TouchableOpacity>
                ) : <View style={[styles.badge, { backgroundColor: "#f3f4f6" }]}><Text style={[styles.badgeText, { color: "#4b5563" }]}>발행 대기</Text></View>}
              </View>
              {s.memo ? <Text style={styles.itemDesc}>{s.memo}</Text> : null}
              {images.length > 0 && (
                <View style={styles.thumbRow}>
                  {images.map((f) => (
                    <TouchableOpacity key={f.url} onPress={() => openFile(f)}>
                      <Image source={{ uri: fileUri(f.url) }} style={styles.thumb} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {others.map((f) => <FileRow key={f.url} f={f} />)}
            </View>
          );
        })}
        <View style={{ height: 80 }} />
      </ScrollView>
      <TouchableOpacity style={styles.fab} onPress={() => setOpen(true)}>
        <Ionicons name="camera-outline" size={20} color="#fff" /><Text style={styles.fabText}>자료 올리기</Text>
      </TouchableOpacity>
      {open && <UploadSheet categories={categories} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(scope); }} />}
    </View>
  );
}

// ── 올리기 창 ───────────────────────────────────────────────
type Picked = { uri: string; name: string; mimeType?: string | null; size?: number | null };

function UploadSheet({ categories, onClose, onDone }: { categories: Category[]; onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<SubmissionFile[]>([]);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [consent, setConsent] = useState(false);
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const [saving, setSaving] = useState(false);

  // 고른 파일들을 차례로 올린다 — files 는 클로저 스냅샷이라 따로 센다
  const uploadAll = async (picked: Picked[]) => {
    let count = files.length;
    if (count + picked.length > MAX_FILES) Alert.alert("알림", `파일은 ${MAX_FILES}개까지입니다. 앞의 ${Math.max(0, MAX_FILES - count)}개만 올립니다.`);
    for (const a of picked) {
      if (count >= MAX_FILES) break;
      const ext = extOf(a.name);
      if (!ALLOWED_EXT.includes(ext)) { Alert.alert("알림", `${a.name}: 사진(HEIC 포함)·워드·엑셀·PPT·PDF·한글·ZIP 만 올릴 수 있습니다.`); continue; }
      if ((a.size ?? 0) > MAX_BYTES) { Alert.alert("알림", `${a.name}: 파일당 50MB 이하만 올릴 수 있습니다.`); continue; }
      setUploading({ name: a.name, pct: 0 });
      try {
        const up = await uploadSubmissionFile({ uri: a.uri, name: a.name, mimeType: a.mimeType }, (pct) => setUploading({ name: a.name, pct }));
        setFiles((prev) => [...prev, up]);
        count++;
        setTitle((t) => t || a.name.replace(/\.[^.]+$/, ""));
      } catch (e: any) {
        Alert.alert("업로드 실패", `${a.name}: ${e?.message || "올리지 못했습니다."}`);
      } finally { setUploading(null); }
    }
  };

  // 사진첩 — 원본 그대로(HEIC 유지). 이름이 없으면 mime 으로 확장자를 정한다
  const imageName = (a: ImagePicker.ImagePickerAsset, i: number) => {
    if (a.fileName && extOf(a.fileName)) return a.fileName;
    const mime = (a.mimeType || "").toLowerCase();
    const ext = mime.includes("heic") ? ".heic" : mime.includes("heif") ? ".heif" : mime.includes("png") ? ".png" : mime.includes("webp") ? ".webp" : mime.includes("gif") ? ".gif" : ".jpg";
    return `photo_${Date.now()}_${i}${ext}`;
  };
  const pickPhotos = async () => {
    if (uploading) return;
    if (files.length >= MAX_FILES) { Alert.alert("알림", `파일은 ${MAX_FILES}개까지입니다.`); return; }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) { Alert.alert("권한 필요", "사진 보관함 접근을 허용해주세요(설정 > 큐브티 > 사진)."); return; }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: Math.max(1, MAX_FILES - files.length), quality: 1, exif: false,
        // 원본 그대로 — iOS 가 HEIC 를 JPEG 로 바꾸지 않게(큐브마케팅이 변환한다)
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      });
      if (result.canceled) return;
      await uploadAll((result.assets ?? []).map((a, i) => ({ uri: a.uri, name: imageName(a, i), mimeType: a.mimeType || "image/jpeg", size: a.fileSize ?? null })));
    } catch (e: any) { setUploading(null); Alert.alert("사진 선택 실패", e?.message || "사진을 고르지 못했습니다."); }
  };
  const takePhoto = async () => {
    if (uploading) return;
    if (files.length >= MAX_FILES) { Alert.alert("알림", `파일은 ${MAX_FILES}개까지입니다.`); return; }
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert("권한 필요", "카메라 접근을 허용해주세요. 사진첩에서 골라 올릴 수도 있습니다."); return; }
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.9, exif: false });
      if (result.canceled) return;
      await uploadAll((result.assets ?? []).map((a, i) => ({ uri: a.uri, name: imageName(a, i), mimeType: a.mimeType || "image/jpeg", size: a.fileSize ?? null })));
    } catch (e: any) { setUploading(null); Alert.alert("촬영 실패", e?.message || "사진을 찍지 못했습니다."); }
  };
  const pickFiles = async () => {
    if (uploading) return;
    if (files.length >= MAX_FILES) { Alert.alert("알림", `파일은 ${MAX_FILES}개까지입니다.`); return; }
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (result.canceled) return;
      await uploadAll((result.assets ?? []).map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size ?? null })));
    } catch (e: any) { setUploading(null); Alert.alert("파일 선택 실패", e?.message || "파일을 고르지 못했습니다."); }
  };

  const submit = async () => {
    if (saving || uploading) return;
    if (!files.length) { Alert.alert("알림", "사진이나 파일을 올려주세요."); return; }
    if (!categoryId) { Alert.alert("알림", "자료 유형을 골라주세요."); return; }
    if (!consent) { Alert.alert("개인정보 확인", "학생·학부모의 얼굴, 이름, 성적이 보이는 경우 외부 게시 동의를 받았거나 가렸다는 확인에 체크해주세요."); return; }
    setSaving(true);
    try {
      await createSubmission({ categoryId, title: title.trim(), memo: memo.trim(), files, consent: true });
      Alert.alert("올렸습니다", "큐브마케팅이 확인한 뒤 블로그에 발행하면 알려드립니다.");
      onDone();
    } catch (e: any) {
      Alert.alert("올리기 실패", e?.response?.data?.error || "올리지 못했습니다.");
    } finally { setSaving(false); }
  };

  const tryClose = () => {
    if (uploading) { Alert.alert("올리는 중", "파일을 올리는 중입니다. 끝난 뒤 닫아주세요."); return; }
    if (saving) { Alert.alert("저장 중", "잠시만 기다려주세요."); return; }
    if (files.length) {
      Alert.alert("닫을까요?", "올린 파일은 저장하지 않으면 사라집니다.", [{ text: "계속 작성", style: "cancel" }, { text: "닫기", style: "destructive", onPress: onClose }]);
      return;
    }
    onClose();
  };
  const active = categories.filter((c) => c.active);
  return (
    <Modal visible animationType="slide" onRequestClose={tryClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#fff" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheetHead}>
          <TouchableOpacity onPress={tryClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
          <Text style={styles.sheetTitle} numberOfLines={1}>마케팅 자료 올리기</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView style={{ flex: 1, padding: 14 }} keyboardShouldPersistTaps="handled">
          <View style={styles.pickRow}>
            <TouchableOpacity style={styles.pickBtn} onPress={pickPhotos} disabled={!!uploading}><Ionicons name="images-outline" size={22} color="#db2777" /><Text style={styles.pickText}>사진첩</Text></TouchableOpacity>
            <TouchableOpacity style={styles.pickBtn} onPress={takePhoto} disabled={!!uploading}><Ionicons name="camera-outline" size={22} color="#db2777" /><Text style={styles.pickText}>카메라</Text></TouchableOpacity>
            <TouchableOpacity style={styles.pickBtn} onPress={pickFiles} disabled={!!uploading}><Ionicons name="attach" size={22} color="#db2777" /><Text style={styles.pickText}>파일</Text></TouchableOpacity>
          </View>
          {uploading ? (
            <View style={styles.progressBox}><ActivityIndicator color="#db2777" /><Text style={styles.progressText}>{uploading.name} 올리는 중… {uploading.pct}%</Text></View>
          ) : <Text style={styles.dropHint}>사진(아이폰 HEIC 원본 그대로)·워드·PPT·PDF·한글·ZIP — 파일당 50MB, {MAX_FILES}개까지</Text>}
          {files.map((f) => <FileRow key={f.url} f={f} onRemove={() => setFiles((prev) => prev.filter((x) => x.url !== f.url))} />)}

          <Text style={styles.label}>자료 유형</Text>
          {!active.length ? (
            <Text style={styles.dropHint}>유형을 불러오지 못했습니다. 목록 화면에서 아래로 당겨 새로고침한 뒤 다시 열어주세요.</Text>
          ) : (
            <View style={styles.chipRow}>
              {active.map((c) => (
                <TouchableOpacity key={c.id} style={[styles.chip, categoryId === c.id && styles.chipOn]} onPress={() => setCategoryId(c.id)}>
                  <Text style={[styles.chipText, categoryId === c.id && styles.chipTextOn]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <Text style={styles.label}>제목</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="예: 9월 과학 실험 수업 — 대치" maxLength={150} />
          <Text style={styles.label}>짧은 설명 (블로그 글의 재료가 됩니다)</Text>
          <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} value={memo} onChangeText={setMemo} placeholder="언제·누가·무엇을 했고 어떤 점이 좋았는지 두세 줄" multiline maxLength={1000} />

          <TouchableOpacity style={[styles.consentBox, consent && styles.consentBoxOn]} onPress={() => setConsent((v) => !v)} activeOpacity={0.8}>
            <Ionicons name={consent ? "checkbox" : "square-outline"} size={22} color={consent ? "#db2777" : "#9ca3af"} />
            <Text style={styles.consentText}><Text style={{ fontWeight: "700" }}>개인정보 확인(필수)</Text> — 학생·학부모의 얼굴, 이름, 성적이 보이는 경우 외부 게시 동의를 받았거나 가렸습니다. 이 자료는 블로그 등 외부에 발행될 수 있습니다.</Text>
          </TouchableOpacity>
          <Text style={styles.dropHint}>지점·직책은 내 정보로 자동으로 붙습니다. 발행 전 검수는 큐브마케팅이 합니다.</Text>
          <View style={{ height: 24 }} />
        </ScrollView>
        <View style={styles.sheetFoot}>
          <TouchableOpacity style={[styles.primaryBtn, (saving || !!uploading || !files.length) && styles.primaryBtnDisabled]} onPress={submit} disabled={saving || !!uploading || !files.length}>
            <Text style={styles.primaryBtnText}>{saving ? "올리는 중…" : "올리기"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 14 },
  intro: { fontSize: 12, color: "#6b7280", lineHeight: 18, marginBottom: 12 },
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabBtnOn: { borderBottomColor: "#db2777" },
  tabText: { fontSize: 14, color: "#6b7280" },
  tabTextOn: { color: "#db2777", fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 12 },
  itemHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  itemTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  itemMeta: { fontSize: 12, color: "#6b7280", marginTop: 4, lineHeight: 17 },
  itemDesc: { fontSize: 13, color: "#374151", marginTop: 6, lineHeight: 19 },
  itemFoot: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  thumbRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  thumb: { width: 84, height: 84, borderRadius: 8, backgroundColor: "#f3f4f6" },
  primaryBtn: { backgroundColor: "#db2777", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  primaryBtnDisabled: { backgroundColor: "#fbcfe8" },
  primaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  empty: { textAlign: "center", color: "#9ca3af", fontSize: 13, paddingVertical: 32, lineHeight: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fef3c7", borderRadius: 10, padding: 10, marginBottom: 12 },
  errorText: { flex: 1, fontSize: 12, color: "#92400e", lineHeight: 17 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#f3f4f6", marginTop: 6 },
  typeBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, minWidth: 26, alignItems: "center" },
  typeBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  fileName: { fontSize: 13, color: "#1f2937" },
  fileSize: { fontSize: 11, color: "#9ca3af" },
  fab: { position: "absolute", right: 16, bottom: 20, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#db2777", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sheetHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingTop: Platform.OS === "ios" ? 54 : 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#e5e7eb", gap: 10 },
  sheetTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: "#111827", textAlign: "center" },
  sheetFoot: { padding: 14, borderTopWidth: 1, borderTopColor: "#e5e7eb", backgroundColor: "#fff" },
  pickRow: { flexDirection: "row", gap: 8 },
  pickBtn: { flex: 1, alignItems: "center", gap: 4, borderWidth: 1.5, borderStyle: "dashed", borderColor: "#fbcfe8", borderRadius: 12, paddingVertical: 14, backgroundColor: "#fdf2f8" },
  pickText: { fontSize: 13, color: "#db2777", fontWeight: "700" },
  progressBox: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  progressText: { fontSize: 12, color: "#db2777" },
  dropHint: { fontSize: 11, color: "#6b7280", marginTop: 6, lineHeight: 16 },
  label: { fontSize: 12, color: "#6b7280", marginTop: 14, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#111827" },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: "#db2777", backgroundColor: "#fdf2f8" },
  chipText: { fontSize: 13, color: "#374151" },
  chipTextOn: { color: "#db2777", fontWeight: "700" },
  consentBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", borderRadius: 10, padding: 12, marginTop: 16 },
  consentBoxOn: { borderColor: "#f9a8d4", backgroundColor: "#fdf2f8" },
  consentText: { flex: 1, fontSize: 12, color: "#374151", lineHeight: 18 },
});
