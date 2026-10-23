import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, RefreshControl } from "react-native";
import { getRequestFeed, type FeedItem } from "../services/approvals";
import { useBadgeCounts } from "../services/badges";
import * as storage from "../services/storage";
import { fmtShort } from "../services/fmt";

// 내 요청(2026-10-07 QA76 #51 #43 #76) — 휴가·휴가 취소·근무 변경·출퇴근 수정 요청 한눈에.
// 2026-10-23(■1 결재 · 앱 1): 직원은 결재하지 않으니 「내가 처리한 것」 탭 없이 목록만, 상태 · 검색은 「찾기」를 눌러 연다.
// 요청 종류 이름은 「근무 변경 · 휴가 · 출퇴근 수정」, 대기 = 주황 알약, 승인 = 파랑(초록 금지)
const KIND: Record<FeedItem["kind"], { label: string; color: string }> = {
  LEAVE: { label: "휴가", color: "#1d4ed8" },
  LEAVE_CANCEL: { label: "휴가 취소", color: "#475569" },
  SCHEDULE: { label: "근무 변경", color: "#4f46e5" },
  ATTENDANCE: { label: "출퇴근 수정", color: "#5b21b6" },
};
// 출퇴근 요청 이름표 — 「출퇴근 수정」은 기록 고치기 · 퇴근 누락에만. 지점 밖 · 사진 · 본부 처리 · 기기 변경은 「출퇴근」(제목에 각자 이름),
// 출퇴근 기록 요청(RECORD, 본부에 기록을 달라는 요청)은 「출퇴근 기록 요청」(2026-10-23 ■0-11)
const kindOf = (i: FeedItem): { label: string; color: string; title: string } => {
  if (i.kind !== "ATTENDANCE") return { ...KIND[i.kind], title: i.title };
  if (/^출퇴근 기록 요청/.test(i.title)) return { label: "출퇴근 기록 요청", color: "#5b21b6", title: "본부에 기록 요청" };
  if (/^(출퇴근\s*기록 수정|퇴근 누락)/.test(i.title)) return { ...KIND.ATTENDANCE, title: i.title };
  return { label: "출퇴근", color: "#5b21b6", title: i.title };
};
const periodText = (p: string) => (/^\d{4}-\d{2}-\d{2}$/.test(p) ? fmtShort(p) : p);
const STATUS: Record<FeedItem["status"], { label: string; color: string; bg: string }> = {
  PENDING: { label: "승인 대기", color: "#b45309", bg: "#fffbeb" },
  APPROVED: { label: "승인", color: "#1e40af", bg: "#dbeafe" },
  REJECTED: { label: "반려", color: "#be123c", bg: "#fff1f2" },
  CANCELLED: { label: "취소함", color: "#475569", bg: "#f1f5f9" },
};
const kst = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
// 올린 때 — 시각을 숨긴 출퇴근 요청(createdAt null)은 날짜만 「올린 날 10/23 (금)」
const uploaded = (i: FeedItem) => (i.createdAt ? `올린 시각 ${kst(i.createdAt)}` : i.createdDate ? `올린 날 ${fmtShort(i.createdDate)}` : "");

export default function RequestsScreen() {
  const [who, setWho] = useState<"mine" | "decided">("mine");
  const [status, setStatus] = useState<"" | FeedItem["status"]>("");
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [limited, setLimited] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  // 결재하는 사람(원장 · 본부 · 원장대행)만 「내가 처리한 것」 탭
  const badges = useBadgeCounts();
  const [role, setRole] = useState("");
  useEffect(() => { storage.getUser().then((u) => setRole(u?.role || "")).catch(() => {}); }, []);
  const decider = role === "ADMIN" || role === "MANAGER" || badges.approver;
  const seq = useRef(0);   // 탭·검색을 빨리 바꾸면 늦게 온 옛 응답이 새 목록을 덮지 않게

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const r = await getRequestFeed(who, { status, q: q.trim() });
      if (my !== seq.current) return;
      setItems(r.items); setLimited(r.limited); setFailed(false);
    } catch { if (my === seq.current) { setItems([]); setLimited(false); setFailed(true); } }
  }, [who, status, q]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  const tab = (on: boolean) => [styles.tab, on && styles.tabOn];
  return (
    <View style={styles.container}>
      {decider && (
        <View style={styles.tabs}>
          <TouchableOpacity style={tab(who === "mine")} onPress={() => setWho("mine")}><Text style={[styles.tabText, who === "mine" && styles.tabTextOn]}>내가 올린 요청</Text></TouchableOpacity>
          <TouchableOpacity style={tab(who === "decided")} onPress={() => setWho("decided")}><Text style={[styles.tabText, who === "decided" && styles.tabTextOn]}>내가 처리한 것</Text></TouchableOpacity>
        </View>
      )}
      {/* 찾기 — 접어 두고 눌러서 연다(목록이 먼저) */}
      <TouchableOpacity style={styles.findBtn} onPress={() => setFindOpen((v) => !v)} accessibilityLabel="찾기">
        <Text style={styles.findText}>{findOpen ? "찾기 닫기" : status || q ? `찾기 · ${status ? STATUS[status].label : ""}${status && q ? " · " : ""}${q}` : "찾기"}</Text>
      </TouchableOpacity>
      {findOpen && (
        <>
          <View style={styles.filters}>
            {(["", "PENDING", "APPROVED", "REJECTED"] as const).map((s) => (
              <TouchableOpacity key={s || "all"} onPress={() => setStatus(s)} style={[styles.chip, status === s && styles.chipOn]}>
                <Text style={[styles.chipText, status === s && styles.chipTextOn]}>{s ? STATUS[s].label : "전체"}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput value={q} onChangeText={setQ} placeholder="제목 · 이름 · 사유 · 의견" style={styles.search} placeholderTextColor="#94a3b8" />
        </>
      )}
      <FlatList
        data={items ?? []}
        keyExtractor={(i) => `${i.kind}:${i.id}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
        ListEmptyComponent={<Text style={styles.empty}>{items === null ? "불러오는 중…" : failed ? "불러오지 못했습니다. 아래로 당겨 다시 시도해 주세요." : who === "mine" ? "올린 요청이 없습니다." : "처리한 요청이 없습니다."}</Text>}
        ListFooterComponent={limited ? <Text style={styles.empty}>최근 요청까지만 보입니다. 검색어로 좁혀 주세요.</Text> : null}
        renderItem={({ item: i }) => { const k = kindOf(i); return (
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={[styles.kind, { color: k.color }]}>{k.label}</Text>
              <Text style={styles.title} numberOfLines={1}>{k.title}</Text>
              <View style={[styles.pill, { backgroundColor: STATUS[i.status].bg }]}><Text style={[styles.status, { color: STATUS[i.status].color }]}>{STATUS[i.status].label}</Text></View>
            </View>
            <Text style={styles.sub}>
              {periodText(i.period)}{who === "decided" ? ` · ${i.requester}` : ""}{i.progress && i.progress.total > 1 ? ` · 결재 ${i.progress.done}/${i.progress.total}` : ""}{i.myDecision ? ` · 내가 ${i.myDecision === "APPROVED" ? "승인" : "반려"}` : ""}
            </Text>
            {!!uploaded(i) && <Text style={styles.sub}>{uploaded(i)}</Text>}
            {!!i.reason && <Text style={styles.sub} numberOfLines={2}>사유: {i.reason}</Text>}
            {!!i.lastComment && !/시프티\s*이관/.test(i.lastComment.text) && <Text style={styles.comment}>의견 · {i.lastComment.by}: {i.lastComment.text}</Text>}
            {i.status === "REJECTED" && !!i.rejectReason && !i.lastComment && <Text style={[styles.comment, { color: "#b91c1c" }]}>반려 사유: {i.rejectReason}</Text>}
          </View>
        ); }}
        contentContainerStyle={{ paddingBottom: 24 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  tabs: { flexDirection: "row", margin: 12, backgroundColor: "#fff", borderRadius: 8, overflow: "hidden", borderWidth: 1, borderColor: "#e5e7eb" },
  tab: { flex: 1, minHeight: 44, justifyContent: "center", alignItems: "center" },
  tabOn: { backgroundColor: "#4f46e5" },
  tabText: { fontSize: 14, color: "#4b5563", fontWeight: "600" },
  tabTextOn: { color: "#fff" },
  filters: { flexDirection: "row", gap: 6, paddingHorizontal: 12 },
  chip: { paddingHorizontal: 12, minHeight: 44, justifyContent: "center", borderRadius: 18, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e2e8f0" },
  chipOn: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  findBtn: { alignSelf: "flex-end", minHeight: 44, justifyContent: "center", paddingHorizontal: 16 },
  findText: { fontSize: 13.5, fontWeight: "700", color: "#4f46e5" },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  chipText: { fontSize: 13, color: "#4b5563" },
  chipTextOn: { color: "#fff" },
  search: { margin: 12, marginBottom: 6, backgroundColor: "#fff", borderRadius: 8, borderWidth: 1, borderColor: "#e5e7eb", paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 40 },
  card: { backgroundColor: "#fff", marginHorizontal: 12, marginTop: 8, borderRadius: 10, padding: 12 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  kind: { fontSize: 12, fontWeight: "700" },
  title: { flex: 1, fontSize: 15, color: "#111827", fontWeight: "600" },
  status: { fontSize: 12, fontWeight: "700" },
  sub: { fontSize: 13.5, color: "#475569", marginTop: 3 },
  comment: { fontSize: 13, color: "#374151", marginTop: 4 },
});
