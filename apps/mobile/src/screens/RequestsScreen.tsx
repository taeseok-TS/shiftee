import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, RefreshControl } from "react-native";
import { getRequestFeed, type FeedItem } from "../services/approvals";

// 내 요청(2026-10-07 QA76 #51 #43 #76) — 휴가·휴가 취소·근무일정·출퇴근 요청 한눈에. 결재하기는 결재 화면에서, 여기는 보기·찾기 전용
const KIND: Record<FeedItem["kind"], { label: string; color: string }> = {
  LEAVE: { label: "휴가", color: "#1d4ed8" },
  LEAVE_CANCEL: { label: "휴가 취소", color: "#c2410c" },
  SCHEDULE: { label: "근무일정", color: "#047857" },
  ATTENDANCE: { label: "출퇴근", color: "#6d28d9" },
};
const STATUS: Record<FeedItem["status"], { label: string; color: string }> = {
  PENDING: { label: "진행 중", color: "#b45309" },
  APPROVED: { label: "승인", color: "#15803d" },
  REJECTED: { label: "반려", color: "#b91c1c" },
  CANCELLED: { label: "취소", color: "#6b7280" },
};
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");

export default function RequestsScreen() {
  const [who, setWho] = useState<"mine" | "decided">("mine");
  const [status, setStatus] = useState<"" | FeedItem["status"]>("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setItems(await getRequestFeed(who, { status, q: q.trim() })); } catch { setItems([]); }
  }, [who, status, q]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const tab = (on: boolean) => [styles.tab, on && styles.tabOn];
  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <TouchableOpacity style={tab(who === "mine")} onPress={() => setWho("mine")}><Text style={[styles.tabText, who === "mine" && styles.tabTextOn]}>내가 올린 요청</Text></TouchableOpacity>
        <TouchableOpacity style={tab(who === "decided")} onPress={() => setWho("decided")}><Text style={[styles.tabText, who === "decided" && styles.tabTextOn]}>내가 처리한 것</Text></TouchableOpacity>
      </View>
      <View style={styles.filters}>
        {(["", "PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
          <TouchableOpacity key={s || "all"} onPress={() => setStatus(s)} style={[styles.chip, status === s && styles.chipOn]}>
            <Text style={[styles.chipText, status === s && styles.chipTextOn]}>{s ? STATUS[s].label : "전체"}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput value={q} onChangeText={setQ} placeholder="제목·이름·의견 검색" style={styles.search} placeholderTextColor="#9ca3af" />
      <FlatList
        data={items ?? []}
        keyExtractor={(i) => `${i.kind}:${i.id}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<Text style={styles.empty}>{items === null ? "불러오는 중…" : who === "mine" ? "올린 요청이 없습니다." : "처리한 요청이 없습니다."}</Text>}
        renderItem={({ item: i }) => (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={[styles.kind, { color: KIND[i.kind].color }]}>{KIND[i.kind].label}</Text>
              <Text style={styles.title} numberOfLines={1}>{i.title}</Text>
              <Text style={[styles.status, { color: STATUS[i.status].color }]}>{STATUS[i.status].label}</Text>
            </View>
            <Text style={styles.sub}>
              {i.period}{who === "decided" ? ` · ${i.requester}` : ""}{i.progress && i.progress.total > 1 ? ` · 결재 ${i.progress.done}/${i.progress.total}` : ""}{i.myDecision ? ` · 내가 ${i.myDecision === "APPROVED" ? "승인" : "반려"}` : ""}
            </Text>
            <Text style={styles.sub}>올린 시각 {kst(i.createdAt)}</Text>
            {!!i.lastComment && <Text style={styles.comment}>💬 {i.lastComment.by}: {i.lastComment.text}</Text>}
            {i.status === "REJECTED" && !!i.rejectReason && !i.lastComment && <Text style={[styles.comment, { color: "#b91c1c" }]}>반려 사유: {i.rejectReason}</Text>}
          </View>
        )}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  tabs: { flexDirection: "row", margin: 12, backgroundColor: "#fff", borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#e5e7eb" },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center" },
  tabOn: { backgroundColor: "#2563eb" },
  tabText: { fontSize: 14, color: "#4b5563", fontWeight: "600" },
  tabTextOn: { color: "#fff" },
  filters: { flexDirection: "row", gap: 6, paddingHorizontal: 12 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb" },
  chipOn: { backgroundColor: "#1f2937", borderColor: "#1f2937" },
  chipText: { fontSize: 13, color: "#4b5563" },
  chipTextOn: { color: "#fff" },
  search: { margin: 12, marginBottom: 6, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#e5e7eb", paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 40 },
  card: { backgroundColor: "#fff", marginHorizontal: 12, marginTop: 8, borderRadius: 10, padding: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  kind: { fontSize: 12, fontWeight: "700" },
  title: { flex: 1, fontSize: 15, color: "#111827", fontWeight: "600" },
  status: { fontSize: 12, fontWeight: "700" },
  sub: { fontSize: 12, color: "#6b7280", marginTop: 3 },
  comment: { fontSize: 12, color: "#374151", marginTop: 4 },
});
