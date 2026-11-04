import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator, Linking, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { C } from "../../services/fmt";
import { getCalendarNotes, reorderCalendarNotes, type CalendarNotePost } from "../../services/schedule";

/* 「이달의 지점 공유」 — 웹 캘린더 오른쪽 칸(#222)을 앱에서도(#234 권경욱 원장). 보기 전용: 올리기 · 고치기 · 고정은 웹 캘린더에서.
   볼 수 있는 지점은 서버가 정한다(관리자 = 전 지점, 원장 = 담당 지점, 직원 = 자기 지점).
   순서 바꾸기(#240)는 원장·관리자에게 ▲▼ — 고정 글은 고정 글끼리, 나머지는 나머지끼리(웹은 끌어 옮기기, 같은 서버) */

// 웹 「이달의 지점 공유」(CalendarNotePanel)와 같은 기준 — 주소 바로 뒤에 붙은 한글 · 닫는 괄호는 링크에서 뺀다
const URL_RE = /(https?:\/\/[^\s<>"'ㄱ-ㅎㅏ-ㅣ가-힣)\]]+)/gi;

function Linked({ text }: { text: string }) {
  const parts = text.split(URL_RE);
  return (
    <Text style={s.body}>
      {parts.map((p, i) => (/^https?:\/\//i.test(p)
        ? <Text key={i} style={s.link} onPress={() => Linking.openURL(p).catch(() => {})}>{p}</Text>
        : <Text key={i}>{p}</Text>))}
    </Text>
  );
}

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const shiftYm = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); return ymOf(new Date(y, m - 1 + n, 1)); };
const fmtAt = (iso: string) => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

export default function BranchShareView() {
  const [ym, setYm] = useState(() => ymOf(new Date()));
  const [ask, setAsk] = useState<string | null>(null);         // 고른 지점(요청용) — null 이면 서버가 볼 수 있는 첫 지점
  const [branch, setBranch] = useState<string | null>(null);   // 서버가 실제로 돌려준 지점(표시용) — 둘을 나눠 첫 조회가 두 번 나가지 않게
  const [branches, setBranches] = useState<string[]>([]);
  const [posts, setPosts] = useState<CalendarNotePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pickOpen, setPickOpen] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [moving, setMoving] = useState(false);
  const seq = useRef(0);   // 빨리 넘길 때 늦게 온 옛 응답이 덮지 않게

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const d = await getCalendarNotes(ym, ask);
      if (my !== seq.current) return;
      setBranches(d.branches); setBranch(d.branch); setPosts(d.posts); setCanManage(d.canManage); setFailed(false);
    } catch {
      if (my === seq.current) setFailed(true);
    } finally {
      if (my === seq.current) { setLoading(false); setRefreshing(false); }
    }
  }, [ym, ask]);
  useEffect(() => { load(); }, [load]);

  // 한 칸 위·아래로 — 화면을 먼저 바꾸고 저장, 실패하면 다시 불러온다
  const move = async (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (!branch || moving || j < 0 || j >= posts.length || posts[i].pinned !== posts[j].pinned) return;
    const next = [...posts];
    [next[i], next[j]] = [next[j], next[i]];
    setPosts(next);
    setMoving(true);
    try {
      await reorderCalendarNotes(ym, branch, next.map((p) => p.id));
    } catch (e: any) {
      Alert.alert("순서를 바꾸지 못했어요", e?.response?.data?.error || "잠시 후 다시 시도해 주세요.");
      load();
    } finally { setMoving(false); }
  };

  const [y, m] = ym.split("-").map(Number);
  return (
    <ScrollView style={{ flex: 1 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}>
      <View style={s.monthBar}>
        <TouchableOpacity onPress={() => { setLoading(true); setPickOpen(false); setYm(shiftYm(ym, -1)); }} style={s.monthBtn}><Ionicons name="chevron-back" size={22} color="#374151" /></TouchableOpacity>
        <Text style={s.monthText}>{y}년 {m}월</Text>
        <TouchableOpacity onPress={() => { setLoading(true); setPickOpen(false); setYm(shiftYm(ym, 1)); }} style={s.monthBtn}><Ionicons name="chevron-forward" size={22} color="#374151" /></TouchableOpacity>
      </View>
      {/* 담당 지점이 둘 이상(겸직 원장 · 관리자)이면 지점 고르기 */}
      {branches.length > 1 && (
        <View style={{ marginHorizontal: 14, marginBottom: 6 }}>
          <TouchableOpacity style={s.pick} onPress={() => setPickOpen((v) => !v)} activeOpacity={0.7}>
            <Text style={s.pickText}>{branch ?? "지점"}</Text>
            <Ionicons name={pickOpen ? "chevron-up" : "chevron-down"} size={16} color={C.sub} />
          </TouchableOpacity>
          {pickOpen && (
            <View style={s.pickList}>
              {branches.map((b) => (
                <TouchableOpacity key={b} style={[s.pickItem, b === branch && s.pickItemOn]} onPress={() => { setPickOpen(false); if (b !== branch) { setLoading(true); setAsk(b); } }}>
                  <Text style={[s.pickItemText, b === branch && { color: C.ind, fontWeight: "700" }]}>{b}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}
      {!!branch && <Text style={s.hint}>{branch} 구성원에게만 보이는 글입니다 · 올리기 · 고치기는 웹 캘린더에서{canManage && posts.length > 1 ? " · ▲▼로 순서 바꾸기" : ""}</Text>}
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={C.ind} />
      ) : failed ? (
        <Text style={s.empty}>불러오지 못했습니다. 아래로 당겨 다시 시도해 주세요.</Text>
      ) : !branch ? (
        <Text style={s.empty}>소속 지점이 없어 지점 공유를 볼 수 없습니다.</Text>
      ) : posts.length === 0 ? (
        <Text style={s.empty}>이 달에 올라온 지점 공유가 없습니다.</Text>
      ) : (
        posts.map((p, i) => {
          const upOk = i > 0 && posts[i - 1].pinned === p.pinned;
          const downOk = i < posts.length - 1 && posts[i + 1].pinned === p.pinned;
          return (
          <View key={p.id} style={[s.card, p.pinned && s.cardPinned]}>
            {p.pinned && <View style={s.pinRow}><Ionicons name="pin" size={13} color={C.amb} /><Text style={s.pinText}>고정</Text></View>}
            <Linked text={p.content} />
            <View style={s.metaRow}>
              <Text style={[s.meta, { flex: 1 }]}>{[p.authorName, fmtAt(p.createdAt), p.edited ? "수정됨" : ""].filter(Boolean).join(" · ")}</Text>
              {canManage && (upOk || downOk) && (
                <View style={s.moveRow}>
                  <TouchableOpacity style={s.moveBtn} disabled={!upOk || moving} onPress={() => move(i, -1)} hitSlop={6} accessibilityLabel="위로">
                    <Ionicons name="chevron-up" size={18} color={upOk && !moving ? C.ind : "#d1d5db"} />
                  </TouchableOpacity>
                  <TouchableOpacity style={s.moveBtn} disabled={!downOk || moving} onPress={() => move(i, 1)} hitSlop={6} accessibilityLabel="아래로">
                    <Ionicons name="chevron-down" size={18} color={downOk && !moving ? C.ind : "#d1d5db"} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          </View>
          );
        })
      )}
      <View style={{ height: 24 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  monthBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 8 },
  monthBtn: { padding: 10 },
  monthText: { fontSize: 18, fontWeight: "700", color: "#111827" },
  hint: { color: C.muted, fontSize: 12.5, marginHorizontal: 16, marginBottom: 4 },
  empty: { color: "#9ca3af", fontSize: 14, textAlign: "center", marginTop: 40, marginHorizontal: 20 },
  card: { backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14, marginHorizontal: 14, marginTop: 10 },
  cardPinned: { backgroundColor: C.ambBg, borderColor: C.ambBd },
  pinRow: { flexDirection: "row", alignItems: "center", gap: 3, marginBottom: 6 },
  pinText: { fontSize: 12, fontWeight: "700", color: C.amb },
  body: { fontSize: 15, lineHeight: 22, color: C.ink },
  link: { color: C.ind, textDecorationLine: "underline" },
  meta: { fontSize: 12, color: C.muted },
  metaRow: { flexDirection: "row", alignItems: "center", marginTop: 10, gap: 8 },
  moveRow: { flexDirection: "row", gap: 4 },
  moveBtn: { width: 34, height: 30, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  pick: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#fff", borderWidth: 1, borderColor: C.line, borderRadius: 10, paddingHorizontal: 12, minHeight: 44 },
  pickText: { fontSize: 15, fontWeight: "600", color: C.ink },
  pickList: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.line, borderRadius: 10, marginTop: 4, overflow: "hidden" },
  pickItem: { paddingHorizontal: 12, minHeight: 44, justifyContent: "center" },
  pickItemOn: { backgroundColor: C.indBg },
  pickItemText: { fontSize: 15, color: C.ink },
});
