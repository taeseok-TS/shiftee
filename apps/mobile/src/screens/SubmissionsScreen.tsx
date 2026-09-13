import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, ActivityIndicator, RefreshControl,
  Modal, Linking, KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { FILE_ORIGIN, fileUri } from "../services/work";
import {
  CATEGORY_GROUP_LABEL, Category, Submission, SubmissionFile, SubmissionRequest,
  createSubmission, deleteSubmission, getCategories, getMyRequests, getSubmissions, uploadSubmissionFile,
} from "../services/submissions";

// 자료제출 (2026-09-13 3단계) — 웹 /work/submissions 의 직원 3탭을 그대로. 본부 화면(요청 걸기·현황표)은 웹에서.
//  내야 할 것: 본부가 나에게 건 제출 요청 → [제출]
//  내 제출: 내가 올린 전부 (확인 전·마감 전이면 삭제 가능)
//  공유 자료: 본부가 내 직군에게 공개한 자료

const ALLOWED_EXT = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf", ".hwp", ".hwpx", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".zip"];
const PREVIEW_EXT = [".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".pdf"];
const MAX_FILES = 10;
const MAX_BYTES = 50 * 1024 * 1024;
const extOf = (n: string) => { const m = /\.[^./\\]+$/.exec(n || ""); return m ? m[0].toLowerCase() : ""; };
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`);
const todayStr = () => { const k = new Date(Date.now() + 9 * 3600 * 1000); return k.toISOString().slice(0, 10); };
function dday(due: string | null): { label: string; bg: string; fg: string } {
  if (!due) return { label: "마감 없음", bg: "#f3f4f6", fg: "#6b7280" };
  const t = todayStr();
  if (due < t) return { label: `${due} 마감 지남`, bg: "#fee2e2", fg: "#b91c1c" };
  const diff = Math.round((Date.parse(due) - Date.parse(t)) / 86400000);
  return { label: diff === 0 ? "오늘 마감" : `${due} 까지 · D-${diff}`, bg: "#fef3c7", fg: "#b45309" };
}
const TYPE_BADGE: Record<string, string> = { word: "#2b579a", excel: "#217346", ppt: "#d24726", pdf: "#b91c1c", hwp: "#0369a1", image: "#6b7280", zip: "#374151", file: "#6b7280" };
const TYPE_LABEL: Record<string, string> = { word: "W", excel: "X", ppt: "P", pdf: "PDF", hwp: "한", image: "IMG", zip: "ZIP", file: "F" };

// 첨부 열기 — 워드·PPT·엑셀·PDF 는 서버 변환 뷰어(외부 브라우저), 나머지는 내려받기. 티켓(?t=)은 fileUri 가 붙인다.
function openFile(f: SubmissionFile) {
  const ext = extOf(f.name);
  const url = fileUri(f.url);
  if (PREVIEW_EXT.includes(ext)) {
    Linking.openURL(`${FILE_ORIGIN}/docs/viewer?src=${encodeURIComponent(url)}&title=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ""))}`).catch(() => Alert.alert("열기 실패", "브라우저를 열 수 없습니다."));
  } else {
    Linking.openURL(url + (url.includes("?") ? "&" : "?") + "download=1").catch(() => Alert.alert("열기 실패", "브라우저를 열 수 없습니다."));
  }
}

function FileRow({ f, onRemove }: { f: SubmissionFile; onRemove?: () => void }) {
  return (
    <View style={styles.fileRow}>
      <View style={[styles.typeBadge, { backgroundColor: TYPE_BADGE[f.type] || TYPE_BADGE.file }]}><Text style={styles.typeBadgeText}>{TYPE_LABEL[f.type] || "F"}</Text></View>
      <TouchableOpacity style={{ flex: 1 }} onPress={() => openFile(f)} disabled={!!onRemove}>
        <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
        <Text style={styles.fileSize}>{fmtBytes(f.size)}</Text>
      </TouchableOpacity>
      {onRemove ? (
        <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="close-circle" size={20} color="#9ca3af" /></TouchableOpacity>
      ) : (
        <Ionicons name="open-outline" size={16} color="#9ca3af" />
      )}
    </View>
  );
}

export default function SubmissionsScreen() {
  const [tab, setTab] = useState<"todo" | "mine" | "shared">("todo");
  const [categories, setCategories] = useState<Category[]>([]);
  const [requests, setRequests] = useState<SubmissionRequest[] | null>(null);
  const [mine, setMine] = useState<Submission[] | null>(null);
  const [shared, setShared] = useState<Submission[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState<{ open: boolean; request?: SubmissionRequest | null }>({ open: false });

  const [loadError, setLoadError] = useState(false);
  const load = useCallback(async () => {
    const [c, r, m, s] = await Promise.allSettled([getCategories(), getMyRequests("open"), getSubmissions("mine"), getSubmissions("shared")]);
    if (c.status === "fulfilled") setCategories(c.value);
    setRequests(r.status === "fulfilled" ? r.value : []);
    setMine(m.status === "fulfilled" ? m.value : []);
    setShared(s.status === "fulfilled" ? s.value : []);
    // 실패를 "없습니다"로 위장하지 않는다(검증관 P3) — 마감 임박 요청이 있는데 없다고 보이면 안 된다
    setLoadError([c, r, m, s].some((x) => x.status === "rejected")); // 분류 실패도 포함 — 자유 올리기가 막힌다
  }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const removeMine = (s: Submission) => {
    Alert.alert("제출물 삭제", `「${s.title}」 을(를) 지울까요?`, [
      { text: "취소", style: "cancel" },
      { text: "지우기", style: "destructive", onPress: async () => {
        try { await deleteSubmission(s.id); load(); }
        catch (e: any) { Alert.alert("삭제 실패", e?.response?.data?.error || "지우지 못했습니다."); }
      } },
    ]);
  };

  const pendingCount = (requests || []).filter((r) => !r.mySubmissionId).length;
  const tabs: [typeof tab, string][] = [["todo", `내야 할 것${pendingCount ? ` ${pendingCount}` : ""}`], ["mine", "내 제출"], ["shared", "공유 자료"]];

  return (
    <View style={{ flex: 1, backgroundColor: "#f3f4f6" }}>
      <View style={styles.tabBar}>
        {tabs.map(([k, label]) => (
          <TouchableOpacity key={k} style={[styles.tabBtn, tab === k && styles.tabBtnOn]} onPress={() => setTab(k)}>
            <Text style={[styles.tabText, tab === k && styles.tabTextOn]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        {loadError && (
          <View style={styles.errorBox}><Ionicons name="cloud-offline-outline" size={16} color="#b45309" /><Text style={styles.errorText}>목록을 불러오지 못했습니다. 연결을 확인하고 아래로 당겨 새로고침해주세요.</Text></View>
        )}
        {tab === "todo" && (
          !requests ? <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
          : requests.length === 0 ? <Text style={styles.empty}>지금 내야 할 자료가 없습니다.{"\n"}본부가 요청을 걸면 여기와 큐브티 봇 알림으로 알려드립니다.</Text>
          : [...requests.filter((r) => !r.mySubmissionId), ...requests.filter((r) => r.mySubmissionId)].map((r) => {
            const d = dday(r.dueDate);
            return (
              <View key={r.id} style={styles.card}>
                <Text style={styles.itemTitle}>{r.title}</Text>
                <Text style={styles.itemMeta}>{r.category ? `${CATEGORY_GROUP_LABEL[r.category.group] ?? ""} › ${r.category.name}` : ""} · 대상 {r.targetJobGroups.length ? r.targetJobGroups.join("·") : "전 직군"} · 본부 {r.createdByName}</Text>
                {r.description ? <Text style={styles.itemDesc}>{r.description}</Text> : null}
                <View style={styles.itemFoot}>
                  {r.mySubmissionId ? (
                    <View style={[styles.badge, { backgroundColor: "#dcfce7" }]}><Text style={[styles.badgeText, { color: "#15803d" }]}>제출 완료</Text></View>
                  ) : (
                    <View style={[styles.badge, { backgroundColor: d.bg }]}><Text style={[styles.badgeText, { color: d.fg }]}>{d.label}</Text></View>
                  )}
                  {!r.mySubmissionId && !r.closedAt && (
                    <TouchableOpacity style={styles.primaryBtnSm} onPress={() => setSheet({ open: true, request: r })}><Text style={styles.primaryBtnText}>제출</Text></TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })
        )}
        {tab === "mine" && (
          !mine ? <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
          : mine.length === 0 ? <Text style={styles.empty}>아직 올린 자료가 없습니다.</Text>
          : mine.map((s) => {
            const due = s.request?.dueDate ?? null;
            // 서버 DELETE 규칙과 같게: 본부 확인 전 · 마감 전 · 요청이 닫히지 않음
            const canDelete = s.status !== "CHECKED" && (!due || due >= todayStr()) && !s.request?.closedAt;
            return (
              <View key={s.id} style={styles.card}>
                <View style={styles.itemHead}>
                  <Text style={[styles.itemTitle, { flex: 1 }]} numberOfLines={2}>{s.title}</Text>
                  {canDelete && <TouchableOpacity onPress={() => removeMine(s)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="trash-outline" size={18} color="#9ca3af" /></TouchableOpacity>}
                </View>
                <Text style={styles.itemMeta}>{s.category ? `${CATEGORY_GROUP_LABEL[s.category.group] ?? ""} › ${s.category.name}` : ""} · {s.yearMonth.replace("-", "년 ")}월 · {new Date(s.createdAt).toLocaleDateString("ko-KR", { month: "numeric", day: "numeric" })} 제출{s.request ? ` · 요청 「${s.request.title}」` : ""}</Text>
                <View style={[styles.itemFoot, { marginBottom: 6 }]}>
                  <View style={[styles.badge, { backgroundColor: s.status === "CHECKED" ? "#dcfce7" : "#f3f4f6" }]}><Text style={[styles.badgeText, { color: s.status === "CHECKED" ? "#15803d" : "#4b5563" }]}>{s.status === "CHECKED" ? "본부 확인" : "제출됨"}</Text></View>
                  {s.shared && <View style={[styles.badge, { backgroundColor: "#e0e7ff" }]}><Text style={[styles.badgeText, { color: "#4338ca" }]}>{s.shareJobGroups.map((g) => (g === "*" ? "전체" : g)).join("·")} 공유</Text></View>}
                </View>
                {s.memo ? <Text style={styles.itemDesc}>{s.memo}</Text> : null}
                {s.files.map((f) => <FileRow key={f.url} f={f} />)}
              </View>
            );
          })
        )}
        {tab === "shared" && (
          !shared ? <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
          : shared.length === 0 ? <Text style={styles.empty}>공유된 자료가 없습니다.</Text>
          : shared.map((s) => (
            <View key={s.id} style={styles.card}>
              <Text style={styles.itemTitle}>{s.title}</Text>
              <Text style={styles.itemMeta}>{[s.userBranch, s.userJobGroup, s.userPosition].filter(Boolean).join(" · ")} <Text style={{ color: "#111827", fontWeight: "700" }}>{s.userName}</Text> · {s.category ? `${CATEGORY_GROUP_LABEL[s.category.group] ?? ""} › ${s.category.name}` : ""} · {s.yearMonth.replace("-", "년 ")}월</Text>
              {s.memo ? <Text style={styles.itemDesc}>{s.memo}</Text> : null}
              {s.files.map((f) => <FileRow key={f.url} f={f} />)}
            </View>
          ))
        )}
        <View style={{ height: 80 }} />
      </ScrollView>
      <TouchableOpacity style={styles.fab} onPress={() => setSheet({ open: true, request: null })}>
        <Ionicons name="cloud-upload-outline" size={20} color="#fff" /><Text style={styles.fabText}>자료 올리기</Text>
      </TouchableOpacity>
      {sheet.open && (
        <SubmitSheet categories={categories} request={sheet.request ?? null} onClose={() => setSheet({ open: false })}
          onDone={() => { setSheet({ open: false }); load(); }} />
      )}
    </View>
  );
}

// ── 올리기 창 ───────────────────────────────────────────────
function SubmitSheet({ categories, request, onClose, onDone }: { categories: Category[]; request: SubmissionRequest | null; onClose: () => void; onDone: () => void }) {
  const [files, setFiles] = useState<SubmissionFile[]>([]);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [categoryId, setCategoryId] = useState(request?.categoryId ?? "");
  const [uploading, setUploading] = useState<{ name: string; pct: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const pick = async () => {
    if (uploading) return;
    if (files.length >= MAX_FILES) { Alert.alert("알림", `파일은 제출당 ${MAX_FILES}개까지입니다.`); return; }
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (result.canceled) return;
      // files 는 클로저 스냅샷이라 루프 안에서 안 늘어난다 — 따로 센다(검증관 C1)
      let count = files.length;
      const assets = result.assets ?? [];
      if (count + assets.length > MAX_FILES) Alert.alert("알림", `파일은 제출당 ${MAX_FILES}개까지입니다. 앞의 ${Math.max(0, MAX_FILES - count)}개만 올립니다.`);
      for (const a of assets) {
        if (count >= MAX_FILES) break;
        const ext = extOf(a.name);
        if (!ALLOWED_EXT.includes(ext)) { Alert.alert("알림", `${a.name}: 워드·엑셀·PPT·PDF·한글·이미지·ZIP 만 올릴 수 있습니다.`); continue; }
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
    } catch (e: any) {
      setUploading(null);
      Alert.alert("파일 선택 실패", e?.message || "파일을 고르지 못했습니다.");
    }
  };

  const submit = async () => {
    if (saving || uploading) return;
    if (!files.length) { Alert.alert("알림", "파일을 올려주세요."); return; }
    if (!request && !categoryId) { Alert.alert("알림", "어디에 올리는 자료인지 골라주세요."); return; }
    setSaving(true);
    try {
      await createSubmission({ requestId: request?.id ?? null, categoryId: request ? undefined : categoryId, title: title.trim(), memo: memo.trim(), files });
      Alert.alert("제출 완료", request ? `「${request.title}」에 제출했습니다.` : "제출했습니다.");
      onDone();
    } catch (e: any) {
      Alert.alert("제출 실패", e?.response?.data?.error || "제출하지 못했습니다.");
    } finally { setSaving(false); }
  };

  // 올리는 중엔 닫지 않는다(검증관 P4) — 닫아도 전송은 계속되고 파일만 서버에 남는다
  const tryClose = () => {
    if (uploading) { Alert.alert("올리는 중", "파일을 올리는 중입니다. 끝난 뒤 닫아주세요."); return; }
    if (saving) { Alert.alert("제출 중", "제출을 처리하는 중입니다. 잠시만 기다려주세요."); return; }
    if (files.length) {
      Alert.alert("닫을까요?", "올린 파일은 제출하지 않으면 사라집니다.", [{ text: "계속 작성", style: "cancel" }, { text: "닫기", style: "destructive", onPress: onClose }]);
      return;
    }
    onClose();
  };
  const groups: ("EDU" | "PROMO" | "EVENT")[] = ["EDU", "PROMO", "EVENT"];
  return (
    <Modal visible animationType="slide" onRequestClose={tryClose}>
      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: "#fff" }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheetHead}>
          <TouchableOpacity onPress={tryClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}><Ionicons name="close" size={24} color="#374151" /></TouchableOpacity>
          <Text style={styles.sheetTitle} numberOfLines={1}>{request ? `제출 — ${request.title}` : "자료 올리기"}</Text>
          <View style={{ width: 24 }} />
        </View>
        <ScrollView style={{ flex: 1, padding: 14 }} keyboardShouldPersistTaps="handled">
          <TouchableOpacity style={styles.dropZone} onPress={pick} disabled={!!uploading}>
            {uploading ? <ActivityIndicator color="#4f46e5" /> : <Ionicons name="attach" size={22} color="#4f46e5" />}
            <Text style={styles.dropText}>{uploading ? `${uploading.name} 올리는 중… ${uploading.pct}%` : "파일 고르기"}</Text>
            <Text style={styles.dropHint}>워드 · 엑셀 · PPT · PDF · 한글 · 이미지 · ZIP — 파일당 50MB, {MAX_FILES}개까지</Text>
          </TouchableOpacity>
          {files.map((f) => <FileRow key={f.url} f={f} onRemove={() => setFiles((prev) => prev.filter((x) => x.url !== f.url))} />)}

          <Text style={styles.label}>제목</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="파일 이름으로 자동으로 채워집니다" maxLength={150} />

          <Text style={styles.label}>어디에</Text>
          {request ? (
            <View style={styles.autoBox}><Text style={styles.autoText}>{request.category ? `${CATEGORY_GROUP_LABEL[request.category.group] ?? ""} › ${request.category.name}` : "요청의 분류"}</Text><Text style={styles.autoTag}>요청</Text></View>
          ) : !categories.some((c) => c.active) ? (
            <Text style={styles.dropHint}>분류를 불러오지 못했습니다. 목록 화면에서 아래로 당겨 새로고침한 뒤 다시 열어주세요.</Text>
          ) : (
            groups.map((g) => {
              const list = categories.filter((c) => c.group === g && c.active);
              if (!list.length) return null;
              return (
                <View key={g} style={{ marginBottom: 6 }}>
                  <Text style={styles.groupLabel}>{CATEGORY_GROUP_LABEL[g]}</Text>
                  <View style={styles.chipRow}>
                    {list.map((c) => (
                      <TouchableOpacity key={c.id} style={[styles.chip, categoryId === c.id && styles.chipOn]} onPress={() => setCategoryId(c.id)}>
                        <Text style={[styles.chipText, categoryId === c.id && styles.chipTextOn]}>{c.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              );
            })
          )}

          <Text style={styles.label}>제출 요청</Text>
          <View style={styles.autoBox}><Text style={styles.autoText}>{request ? `${request.title}${request.dueDate ? ` (${request.dueDate}까지)` : ""}` : "자유 제출"}</Text><Text style={styles.autoTag}>자동</Text></View>
          <Text style={styles.label}>지점 · 직책 · 직급 · 연월</Text>
          <View style={styles.autoBox}><Text style={styles.autoText}>내 직원 정보와 이번 달로 채워집니다</Text><Text style={styles.autoTag}>자동</Text></View>

          <Text style={styles.label}>메모 (선택)</Text>
          <TextInput style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} value={memo} onChangeText={setMemo} placeholder="본부에 전할 말" multiline maxLength={1000} />
          <View style={{ height: 24 }} />
        </ScrollView>
        <View style={styles.sheetFoot}>
          <TouchableOpacity style={[styles.primaryBtn, (saving || !!uploading || !files.length) && styles.primaryBtnDisabled]} onPress={submit} disabled={saving || !!uploading || !files.length}>
            <Text style={styles.primaryBtnText}>{saving ? "제출 중…" : "제출"}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 14 },
  tabBar: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  tabBtn: { flex: 1, paddingVertical: 12, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabBtnOn: { borderBottomColor: "#4f46e5" },
  tabText: { fontSize: 14, color: "#6b7280" },
  tabTextOn: { color: "#4f46e5", fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 14, marginBottom: 12 },
  itemHead: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  itemTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  itemMeta: { fontSize: 12, color: "#6b7280", marginTop: 4, lineHeight: 17 },
  itemDesc: { fontSize: 13, color: "#374151", marginTop: 6, lineHeight: 19 },
  itemFoot: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  primaryBtn: { backgroundColor: "#4f46e5", borderRadius: 10, paddingVertical: 12, alignItems: "center" },
  primaryBtnSm: { backgroundColor: "#4f46e5", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 16, marginLeft: "auto" },
  primaryBtnDisabled: { backgroundColor: "#c7d2fe" },
  primaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  empty: { textAlign: "center", color: "#9ca3af", fontSize: 13, paddingVertical: 32, lineHeight: 20 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#fef3c7", borderRadius: 10, padding: 10, marginBottom: 12 },
  errorText: { flex: 1, fontSize: 12, color: "#92400e", lineHeight: 17 },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, borderTopWidth: 1, borderTopColor: "#f3f4f6", marginTop: 6 },
  typeBadge: { borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, minWidth: 26, alignItems: "center" },
  typeBadgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  fileName: { fontSize: 13, color: "#1f2937" },
  fileSize: { fontSize: 11, color: "#9ca3af" },
  fab: { position: "absolute", right: 16, bottom: 20, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#4f46e5", borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12, elevation: 4, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 } },
  fabText: { color: "#fff", fontWeight: "700", fontSize: 14 },
  sheetHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingTop: Platform.OS === "ios" ? 54 : 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "#e5e7eb", gap: 10 },
  sheetTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: "#111827", textAlign: "center" },
  sheetFoot: { padding: 14, borderTopWidth: 1, borderTopColor: "#e5e7eb", backgroundColor: "#fff" },
  dropZone: { borderWidth: 1.5, borderStyle: "dashed", borderColor: "#c7d2fe", borderRadius: 12, padding: 18, alignItems: "center", backgroundColor: "#eef2ff" },
  dropText: { fontSize: 14, color: "#4f46e5", fontWeight: "700", marginTop: 6 },
  dropHint: { fontSize: 11, color: "#6b7280", marginTop: 4, textAlign: "center" },
  label: { fontSize: 12, color: "#6b7280", marginTop: 14, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#111827" },
  autoBox: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, backgroundColor: "#f3f4f6" },
  autoText: { fontSize: 14, color: "#374151", flex: 1 },
  autoTag: { fontSize: 10, color: "#9ca3af", marginLeft: 8 },
  groupLabel: { fontSize: 11, color: "#9ca3af", marginBottom: 4 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: "#fff" },
  chipOn: { borderColor: "#4f46e5", backgroundColor: "#eef2ff" },
  chipText: { fontSize: 13, color: "#374151" },
  chipTextOn: { color: "#4f46e5", fontWeight: "700" },
});
