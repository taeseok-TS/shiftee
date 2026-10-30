import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LEAVE_LABELS, syncLeaveLabels } from "../services/leaveLabels";
import { getBranchDay, isPartialLeave, nowKindOf, NOW_LABEL, type BranchDay, type BranchDayRow, type NowKind } from "../services/schedule";
import { C, fmtTime } from "../services/fmt";

// 지점 일정 — 하루 단위 지점 직원 전원(2026-10-23 조혜련 원장 문의, 시프티 앱 근무일정 탭과 같은 모양).
// 2026-10-23 본부 요청(앱 6 · 시안 S2-3): 문제 있는 사람부터(미출근 → 지각 → 퇴근 누락 → 휴가 → 정상), 정상 · 휴무는 접어 두기.
// 오른쪽은 상태 알약 하나만(왼쪽 「휴가」 + 오른쪽 「휴가」 겹침 정리). 출퇴근 시각 · 일한 시간은 원장 화면에 보이지 않는다(본부만, ■0-11).
// 본부(관리자) 「전체 지점 일정」은 지점별로 묶는다(「평촌 11명」).
// 2026-10-25: 여러 날 · 여러 명 한 번에 넣기(BranchScheduleBulkScreen) — 10/30 #236 부터 출퇴근 탭 「근무일정 추가」에서 연다. reloadKey 가 바뀌면 다시 불러온다.

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (ymd: string, n: number) => { const d = dateOf(ymd); d.setDate(d.getDate() + n); return ymdOf(d); };

type Badge = { text: string; tone: "red" | "blue" | "gray" | "light" | "amb" };
const TONE: Record<Badge["tone"], { fg: string; bg: string }> = {
  red: { fg: C.red, bg: C.redBg }, blue: { fg: C.blueInk, bg: C.blueBg }, gray: { fg: C.gray, bg: C.grayBg },
  light: { fg: "#94a3b8", bg: "#f8fafc" }, amb: { fg: C.amb, bg: C.ambBg },
};
// 줄 순서 — 문제 있는 사람부터
const RANK = { missing: 0, late: 1, early: 2, unclosed: 3, leave: 4, before: 5, normal: 6, rest: 7 } as const;
type Rank = keyof typeof RANK;

/** showBranch = 본부(관리자) 보기 — 지점별 묶음 + 출퇴근 시각(본부만 보는 값). reloadKey 가 바뀌면 보던 날짜를 다시 읽는다(일정 넣기 뒤) */
export default function BranchDayView({ showBranch = false, reloadKey = 0 }: { showBranch?: boolean; reloadKey?: number }) {
  const today = ymdOf(new Date());
  const [day, setDay] = useState(today);
  const [data, setData] = useState<BranchDay | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openNormal, setOpenNormal] = useState(false);
  const [openRest, setOpenRest] = useState(false);
  const seq = useRef(0);   // 빠르게 날짜를 넘길 때 늦게 온 옛 날짜가 화면을 덮지 않게

  const load = useCallback(async (d: string) => {
    const my = ++seq.current;
    try {
      // 본부가 만든 유형의 이름 · 단위를 같이 받아 둔다(그려지기 전에 — 3차 검증 P1)
      const [r] = await Promise.all([getBranchDay(d), syncLeaveLabels().catch(() => {})]);
      if (my !== seq.current) return;
      setData(r); setError("");
    } catch {
      if (my !== seq.current) return;
      setError("지점 일정을 불러오지 못했습니다. 아래로 당겨 다시 시도해 주세요.");
    } finally {
      if (my === seq.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);
  // 날짜가 바뀌거나 「일정 넣기」로 넣은 뒤(reloadKey) — 한 효과로 한 번만 읽는다(따로 두면 reloadKey>0 상태로 다시 마운트될 때 같은 날을 두 번 읽었다)
  useEffect(() => { load(day); }, [day, reloadKey, load]);
  // 탭에 다시 들어오면 새로 읽는다(처음 한 번은 위에서 — 검증 8)
  const first = useRef(true);
  const dayRef = useRef(day); dayRef.current = day;
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } load(dayRef.current); }, [load]));

  const go = (d: string) => { setLoading(true); setOpenNormal(false); setOpenRest(false); setDay(d); };
  const dd = dateOf(day);
  const isToday = day === today;
  const n = new Date();
  const nowHHmm = isToday ? `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}` : undefined;
  const past = day < today;
  const hidden = !!data?.attendanceHidden;
  // 시각을 덧붙일지 — 서버 timesHidden 으로(원장이 「출퇴근 시각 보기」를 켜면 보인다, 검증 B4). 옛 서버면 본부 보기일 때만
  const showTimes = data?.timesHidden === undefined ? showBranch : !data.timesHidden;
  // 오늘이 아니면 「지금」 대신: 앞날은 근무 예정, 지난날은 기록대로(퇴근 · 퇴근 누락 · 미출근 · 기록 없음).
  // 출퇴근 열람이 꺼졌으면 기록이 없는 게 아니라 감춰진 것 — 지난날은 「근무」(검증 2 · N5)
  const kindOf = (r: BranchDayRow): NowKind => {
    const k = nowKindOf(r, nowHHmm);
    if (isToday || ["leave", "off", "none", "done", "absent", "in"].includes(k)) return k;
    if (hidden) return past ? "worked" : k;
    if (k === "working") return past ? "unclosed" : k;
    return past ? "noRecord" : "planned";
  };
  const view = (r: BranchDayRow): { rank: Rank; badge: Badge } => {
    const k = kindOf(r);
    if (k === "missing" || k === "absent") return { rank: "missing", badge: { text: "미출근", tone: "red" } };
    if (k === "noRecord") return { rank: "missing", badge: { text: NOW_LABEL.noRecord, tone: "red" } };
    if (r.status === "LATE" && k !== "leave") return { rank: k === "unclosed" ? "unclosed" : "late", badge: { text: k === "unclosed" ? "지각 · 퇴근 누락" : "지각", tone: "red" } };
    if (r.status === "EARLY_LEAVE" && k !== "leave") return { rank: "early", badge: { text: "조퇴", tone: "red" } };
    if (k === "unclosed") return { rank: "unclosed", badge: { text: "퇴근 누락", tone: "red" } };
    if (k === "leave") return { rank: "leave", badge: { text: "휴가", tone: "blue" } };
    if (k === "notYet") return { rank: "before", badge: { text: "출근 전", tone: "gray" } };
    if (k === "planned") return { rank: "before", badge: { text: NOW_LABEL.planned, tone: "gray" } };
    if (k === "working" || k === "in" || k === "done" || k === "worked") return { rank: "normal", badge: { text: k === "done" ? "퇴근" : k === "worked" ? "근무" : "출근", tone: "gray" } };
    return { rank: "rest", badge: { text: NOW_LABEL[k], tone: "light" } };   // 휴무 · 일정 없음
  };
  const all = data && data.date === day ? data.employees : [];
  const rows = all
    .map((r) => ({ r, ...view(r) }))
    .sort((a, b) => RANK[a.rank] - RANK[b.rank] || (a.r.startTime || "99").localeCompare(b.r.startTime || "99") || a.r.name.localeCompare(b.r.name, "ko"));
  const working = rows.filter((x) => x.rank !== "leave" && x.rank !== "rest").length;
  const onLeave = rows.filter((x) => x.rank === "leave").length;

  // 줄 설명 — 근무일정(「13:00 출근 예정」 · 「13:00–22:00」)과 휴가 이름. 시각 기록은 본부 계정에만 덧붙인다
  const subOf = (x: (typeof rows)[number]) => {
    const r = x.r;
    const leave = r.leaveType ? LEAVE_LABELS[r.leaveType] || r.leaveType : "";
    const workTime = r.startTime && r.endTime && r.scheduleType === "work" ? fmtTime(r.startTime, r.endTime) : "";
    const parts: string[] = [];
    if (x.rank === "leave") parts.push(leave ? `${leave} · ${isPartialLeave(r.leaveType) && workTime ? workTime : "하루"}` : "휴가");
    else if (x.rank === "rest") parts.push(r.status === "NO_SCHEDULE" ? "일정 없음" : "쉬는 날");
    else if (workTime) parts.push(isToday && (x.rank === "missing" || x.rank === "late" || x.rank === "before") ? `${r.startTime} 출근 예정` : workTime);
    if (x.rank !== "leave" && leave) parts.push(leave);
    if (r.position && r.position !== "-") parts.push(r.position);
    if (showTimes && r.clockIn) parts.push(`출근 ${r.clockIn}${r.clockOut ? ` · 퇴근 ${r.clockOut}` : ""}`);   // 본부 · 「출퇴근 시각 보기」 켠 원장만(■0-11)
    return parts.join(" · ");
  };

  const Row = ({ x, line }: { x: (typeof rows)[number]; line: boolean }) => (
    <View style={[s.it, line && s.itLine]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.name} numberOfLines={1}>{x.r.name}</Text>
        <Text style={s.sub} numberOfLines={1}>{subOf(x)}</Text>
      </View>
      <View style={[s.badge, { backgroundColor: TONE[x.badge.tone].bg }]}>
        <Text style={[s.badgeText, { color: TONE[x.badge.tone].fg }]}>{x.badge.text}</Text>
      </View>
    </View>
  );
  // 한 묶음(지점) — 문제 · 휴가 · 출근 전은 펼쳐 두고, 정상 · 휴무는 「N명 더 보기」
  const Group = ({ list, title }: { list: typeof rows; title?: string }) => {
    const top = list.filter((x) => x.rank !== "normal" && x.rank !== "rest");
    const normal = list.filter((x) => x.rank === "normal");
    const rest = list.filter((x) => x.rank === "rest");
    const showNormal = openNormal || top.length === 0;
    return (
      <View style={{ marginBottom: 12 }}>
        {!!title && <Text style={s.groupTitle}>{title} {list.filter((x) => x.rank !== "rest").length}명</Text>}
        <View style={s.lst}>
          {top.map((x, i) => <Row key={x.r.id} x={x} line={i > 0} />)}
          {showNormal ? normal.map((x, i) => <Row key={x.r.id} x={x} line={top.length + i > 0} />) : normal.length > 0 && (
            <TouchableOpacity style={[s.it, top.length > 0 && s.itLine]} onPress={() => setOpenNormal(true)}>
              <Text style={s.more}>{hidden ? "근무" : isToday ? "정상 출근" : "정상"} {normal.length}명 더 보기 ›</Text>
            </TouchableOpacity>
          )}
          {openRest ? rest.map((x, i) => <Row key={x.r.id} x={x} line={top.length + normal.length + i > 0} />) : rest.length > 0 && (
            <TouchableOpacity style={[s.it, (top.length > 0 || normal.length > 0) && s.itLine]} onPress={() => setOpenRest(true)}>
              <Text style={s.more}>휴무 · 일정 없음 {rest.length}명 보기 ›</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };
  const branches = showBranch ? [...new Set(rows.map((x) => x.r.branch || "지점 없음"))].sort((a, b) => a.localeCompare(b, "ko")) : [];
  // 본부: 문제 있는 사람이 있는 지점을 먼저
  branches.sort((a, b) => {
    const p = (br: string) => rows.filter((x) => (x.r.branch || "지점 없음") === br && RANK[x.rank] <= RANK.unclosed).length;
    return p(b) - p(a) || a.localeCompare(b, "ko");
  });

  return (
    <View style={{ flex: 1 }}>
      <View style={s.dayBar}>
        <TouchableOpacity onPress={() => go(addDays(day, -1))} style={s.navBtn} accessibilityLabel="전날">
          <Ionicons name="chevron-back" size={22} color={C.ind} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => go(today)} style={{ flex: 1, alignItems: "center" }} activeOpacity={0.7}>
          <Text style={s.dayText}>{dd.getMonth() + 1}월 {dd.getDate()}일 ({WEEKDAYS[dd.getDay()]}){isToday ? " · 오늘" : ""}</Text>
          {!isToday && <Text style={s.hint}>누르면 오늘</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => go(addDays(day, 1))} style={s.navBtn} accessibilityLabel="다음 날">
          <Ionicons name="chevron-forward" size={22} color={C.ind} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(day); }} />}
      >
        {loading ? (
          <ActivityIndicator size="large" color={C.ind} style={{ marginTop: 40 }} />
        ) : error ? (
          <Text style={s.empty}>{error}</Text>
        ) : (
          <>
            <Text style={s.summary}>근무 {working}명 · 휴가 {onLeave}명</Text>
            {hidden && <Text style={s.note}>본부 설정으로 출퇴근 상태는 보이지 않습니다(일정 · 휴가만).</Text>}
            {rows.length === 0 ? (
              <Text style={s.empty}>지점 직원이 없습니다.</Text>
            ) : showBranch ? (
              branches.map((br) => <Group key={br} title={br} list={rows.filter((x) => (x.r.branch || "지점 없음") === br)} />)
            ) : (
              <Group list={rows} />
            )}
            <Text style={s.footer}>여러 날 · 여러 명의 근무일정은 출퇴근 탭 「근무일정 추가」로 한 번에 넣을 수 있습니다. 하루 단위 고치기는 PC(cubetee.co.kr) 원장 모드 「근태 › 지점 근무일정」에서 합니다.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  dayBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 6, paddingVertical: 4, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  navBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  dayText: { fontSize: 16, fontWeight: "700", color: C.ink },
  hint: { fontSize: 12, color: C.muted, marginTop: 2 },
  summary: { fontSize: 13.5, color: C.sub, marginBottom: 8 },
  note: { fontSize: 13, color: C.muted, marginBottom: 8 },
  empty: { textAlign: "center", color: C.muted, marginTop: 32 },
  groupTitle: { fontSize: 15, fontWeight: "700", color: C.ink, marginBottom: 6, marginLeft: 2 },
  lst: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  it: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11, minHeight: 56 },
  itLine: { borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  name: { fontSize: 14.5, fontWeight: "700", color: C.ink },
  sub: { fontSize: 13.5, color: C.sub, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12.5, fontWeight: "700" },
  more: { fontSize: 13.5, color: C.sub },
  footer: { fontSize: 13, color: C.muted, marginTop: 4, textAlign: "center", lineHeight: 19 },
});
