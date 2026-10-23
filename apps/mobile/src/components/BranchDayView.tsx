import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LEAVE_LABELS, syncLeaveLabels } from "../services/leaveLabels";
import { getBranchDay, isPartialLeave, nowKindOf, NOW_LABEL, type BranchDay, type BranchDayRow, type NowKind } from "../services/schedule";

// 지점 일정 — 하루 단위 지점 직원 전원(2026-10-23 조혜련 원장 문의, 시프티 앱 근무일정 탭과 같은 모양).
// 날짜를 넘기며 그날 누가 몇 시부터 몇 시까지 일하는지 · 휴가 · 휴무를 본다. 오늘이면 지금 상태(근무 중 · 출근 전 · 퇴근)도.
// 일정 추가 · 일괄 등록은 웹 원장 모드 「근태 › 지점 근무일정」(앱은 보기만).

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (ymd: string, n: number) => { const d = dateOf(ymd); d.setDate(d.getDate() + n); return ymdOf(d); };

const KIND_COLOR: Record<NowKind, { fg: string; bg: string }> = {
  working: { fg: "#4f46e5", bg: "#eef2ff" },
  done: { fg: "#475569", bg: "#f1f5f9" },
  notYet: { fg: "#b45309", bg: "#fffbeb" },
  missing: { fg: "#dc2626", bg: "#fef2f2" },
  absent: { fg: "#dc2626", bg: "#fef2f2" },
  leave: { fg: "#7c3aed", bg: "#f5f3ff" },
  off: { fg: "#64748b", bg: "#f8fafc" },
  none: { fg: "#94a3b8", bg: "#f8fafc" },
  planned: { fg: "#4f46e5", bg: "#eef2ff" },
  noRecord: { fg: "#94a3b8", bg: "#f8fafc" },
  worked: { fg: "#475569", bg: "#f1f5f9" },
  unclosed: { fg: "#dc2626", bg: "#fef2f2" },
};

// 근무 → 휴가 → 휴무 → 일정 없음(배지 기준), 같은 무리는 시작 시각 · 이름 순
const RANK: Partial<Record<NowKind, number>> = { leave: 1, off: 2, none: 3 };
const sortRows = (rows: BranchDayRow[], kindOf: (r: BranchDayRow) => NowKind) =>
  [...rows].sort((a, b) => (RANK[kindOf(a)] ?? 0) - (RANK[kindOf(b)] ?? 0) || (a.startTime || "99").localeCompare(b.startTime || "99") || a.name.localeCompare(b.name, "ko"));

export default function BranchDayView({ showBranch = false }: { showBranch?: boolean }) {
  const today = ymdOf(new Date());
  const [day, setDay] = useState(today);
  const [data, setData] = useState<BranchDay | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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
  useEffect(() => { load(day); }, [day, load]);
  // 탭에 다시 들어오면 새로 읽는다(처음 한 번은 위에서 — 검증 8)
  const first = useRef(true);
  const dayRef = useRef(day); dayRef.current = day;
  useFocusEffect(useCallback(() => { if (first.current) { first.current = false; return; } load(dayRef.current); }, [load]));

  const go = (d: string) => { setLoading(true); setDay(d); };
  const dd = dateOf(day);
  const isToday = day === today;
  const n = new Date();
  const nowHHmm = isToday ? `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}` : undefined;
  // 배지 — 오늘이 아니면 「지금」 대신: 앞날은 근무 예정, 지난날은 기록대로(퇴근 · 결근 · 기록 없음 · 퇴근 미기록).
  // 출퇴근 열람이 꺼졌으면 기록이 없는 게 아니라 감춰진 것 — 지난날은 「근무」(검증 2 · N5)
  const past = day < today;
  const kindOf = (r: BranchDayRow): NowKind => {
    const k = nowKindOf(r, nowHHmm);
    if (isToday || ["leave", "off", "none", "done", "absent"].includes(k)) return k;
    if (data?.attendanceHidden) return past ? "worked" : k;
    if (k === "working") return past ? "unclosed" : k;
    return past ? "noRecord" : "planned";
  };
  const rows = data && data.date === day ? sortRows(data.employees, kindOf) : [];
  // 인원 = 배지 하나로만 센다(휴가 배지 = 휴가, 나머지 근무 배지 = 근무 — 반차 뒤 출근은 근무, 검증 N1)
  const WORK_KINDS: NowKind[] = ["working", "done", "notYet", "missing", "absent", "planned", "worked", "noRecord", "unclosed"];
  const working = rows.filter((r) => WORK_KINDS.includes(kindOf(r)));
  const onLeave = rows.filter((r) => kindOf(r) === "leave");

  return (
    <View style={{ flex: 1 }}>
      <View style={s.dayBar}>
        <TouchableOpacity onPress={() => go(addDays(day, -1))} style={s.navBtn} accessibilityLabel="전날">
          <Ionicons name="chevron-back" size={22} color="#374151" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => go(today)} style={{ flex: 1, alignItems: "center" }} activeOpacity={0.7}>
          <Text style={s.dayText}>{dd.getMonth() + 1}월 {dd.getDate()}일 ({WEEKDAYS[dd.getDay()]}){isToday ? " · 오늘" : ""}</Text>
          {!isToday && <Text style={s.hint}>누르면 오늘</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => go(addDays(day, 1))} style={s.navBtn} accessibilityLabel="다음 날">
          <Ionicons name="chevron-forward" size={22} color="#374151" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(day); }} />}
      >
        {loading ? (
          <ActivityIndicator size="large" color="#4f46e5" style={{ marginTop: 40 }} />
        ) : error ? (
          <Text style={s.empty}>{error}</Text>
        ) : (
          <>
            <Text style={s.summary}>
              근무 {working.length}명 · 휴가 {onLeave.length}명 · 전체 {rows.length}명
            </Text>
            {data?.attendanceHidden && <Text style={s.note}>본부 설정으로 출퇴근 시각은 보이지 않습니다(일정 · 휴가만).</Text>}
            {rows.length === 0 ? (
              <Text style={s.empty}>지점 직원이 없습니다.</Text>
            ) : (
              rows.map((r) => {
                const kind = kindOf(r);
                const c = KIND_COLOR[kind];
                // 하루 전체 휴가면 시간 대신 「휴가」(반차 · 반반차는 근무 시간도 보인다)
                const time = r.startTime && r.endTime && r.scheduleType === "work" && (r.status !== "LEAVE" || isPartialLeave(r.leaveType)) ? `${r.startTime} ~ ${r.endTime}` : "";
                const leave = r.leaveType ? LEAVE_LABELS[r.leaveType] || r.leaveType : "";
                return (
                  <View key={r.id} style={s.row}>
                    <View style={s.timeCol}>
                      <Text style={[s.time, !time && { color: "#94a3b8" }]}>{time || (r.status === "LEAVE" ? "휴가" : kind === "off" ? "휴무" : "—")}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={s.name} numberOfLines={2}>{r.name}<Text style={s.pos}>  {r.position !== "-" ? r.position : ""}{showBranch && r.branch ? ` · ${r.branch}` : ""}</Text></Text>
                      {(leave || r.clockIn || r.status === "LATE" || r.status === "EARLY_LEAVE") ? (
                        <Text style={s.sub} numberOfLines={1}>
                          {[leave, r.clockIn ? `출근 ${r.clockIn}` : "", r.clockOut ? `퇴근 ${r.clockOut}` : "", r.status === "LATE" ? "지각" : "", r.status === "EARLY_LEAVE" ? "조퇴" : ""].filter(Boolean).join(" · ")}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[s.badge, { backgroundColor: c.bg }]}>
                      <Text style={[s.badgeText, { color: c.fg }]}>{NOW_LABEL[kind]}</Text>
                    </View>
                  </View>
                );
              })
            )}
            <Text style={s.footer}>일정 추가 · 일괄 등록은 웹(cubetee.co.kr) 원장 모드 「근태 › 지점 근무일정」에서 합니다.</Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  dayBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 8, paddingVertical: 10, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  navBtn: { padding: 8 },
  dayText: { fontSize: 17, fontWeight: "700", color: "#111827" },
  hint: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  summary: { fontSize: 13, color: "#475569", marginBottom: 8 },
  note: { fontSize: 12, color: "#64748b", marginBottom: 8 },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 32 },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8, borderWidth: 1, borderColor: "#eef1f5", gap: 10 },
  timeCol: { width: 96 },
  time: { fontSize: 13, fontWeight: "600", color: "#0f172a" },
  name: { fontSize: 15, fontWeight: "600", color: "#111827" },
  pos: { fontSize: 12, fontWeight: "400", color: "#64748b" },
  sub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "600" },
  footer: { fontSize: 12, color: "#94a3b8", marginTop: 12, textAlign: "center" },
});
