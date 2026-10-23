import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { getBranchDay, nowKindOf, NOW_LABEL, type BranchDay, type NowKind } from "../services/schedule";

// 홈 「현재 근무 상황」(원장 · 관리자, 2026-10-23 조혜련 원장 문의 — 시프티 앱 홈 카드와 같은 역할).
// 오늘 지점 직원을 지금 상태로 센다: 근무 중 · 출근 전 · 지각 · 조퇴 · 휴가 · 결근 · 일정 없음. 칸을 누르면 그 사람들 이름.
// 숫자는 웹 원장 대시보드와 같은 GET /api/schedule/day 에서 — 홈을 다시 보거나 당겨서 새로 고칠 때마다 다시 읽는다

type Chip = { key: string; label: string; names: string[]; color: string };
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export default function BranchNowCard({ reloadKey, onOpenSchedule, scheduleLabel = "지점 일정" }: { reloadKey: number; onOpenSchedule: () => void; scheduleLabel?: string }) {
  const [data, setData] = useState<BranchDay | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const seq = useRef(0);   // 늦게 온 옛 응답이 새 응답을 덮지 않게
  const load = useCallback(() => {
    const my = ++seq.current;
    getBranchDay(ymdOf(new Date()))
      .then((d) => { if (my === seq.current) { setData(d); setFailed(false); } })
      .catch(() => { if (my === seq.current) setFailed(true); });
  }, []);
  useFocusEffect(load);   // 처음 · 홈으로 돌아올 때
  useEffect(() => { if (reloadKey) load(); }, [load, reloadKey]);   // 당겨서 새로 고침

  const rows = data?.employees ?? [];
  const n = new Date();
  const nowHHmm = `${String(n.getHours()).padStart(2, "0")}:${String(n.getMinutes()).padStart(2, "0")}`;
  const by = (pred: (k: NowKind, r: (typeof rows)[number]) => boolean) => rows.filter((r) => pred(nowKindOf(r, nowHHmm), r)).map((r) => r.name);
  const chips: Chip[] = data?.attendanceHidden
    ? [
        { key: "planned", label: "근무 예정", names: by((k) => k === "planned"), color: "#4f46e5" },
        { key: "leave", label: NOW_LABEL.leave, names: by((k) => k === "leave"), color: "#7c3aed" },
        { key: "off", label: NOW_LABEL.off, names: by((k) => k === "off"), color: "#94a3b8" },
        { key: "none", label: NOW_LABEL.none, names: by((k) => k === "none"), color: "#94a3b8" },
      ]
    : [
        { key: "working", label: NOW_LABEL.working, names: by((k) => k === "working"), color: "#4f46e5" },
        { key: "notYet", label: NOW_LABEL.notYet, names: by((k) => k === "notYet"), color: "#b45309" },
        { key: "missing", label: "미출근", names: by((k) => k === "missing" || k === "absent"), color: "#dc2626" },
        { key: "late", label: "지각", names: by((_, r) => r.status === "LATE"), color: "#dc2626" },
        { key: "early", label: "조퇴", names: by((_, r) => r.status === "EARLY_LEAVE"), color: "#dc2626" },
        { key: "done", label: NOW_LABEL.done, names: by((k) => k === "done"), color: "#475569" },
        { key: "leave", label: NOW_LABEL.leave, names: by((k) => k === "leave"), color: "#7c3aed" },
        { key: "off", label: NOW_LABEL.off, names: by((k) => k === "off"), color: "#94a3b8" },
        { key: "none", label: NOW_LABEL.none, names: by((k) => k === "none"), color: "#94a3b8" },
      ];
  const opened = chips.find((c) => c.key === open);

  return (
    <View style={s.card}>
      <View style={s.head}>
        <Text style={s.title}>현재 근무 상황</Text>
        <TouchableOpacity onPress={onOpenSchedule} style={s.link} activeOpacity={0.7}>
          <Text style={s.linkText}>{scheduleLabel}</Text>
          <Ionicons name="chevron-forward" size={14} color="#4f46e5" />
        </TouchableOpacity>
      </View>
      {failed && !data ? (
        <Text style={s.muted}>불러오지 못했습니다. 아래로 당겨 다시 시도해 주세요.</Text>
      ) : !data ? (
        <Text style={s.muted}>불러오는 중…</Text>
      ) : (
        <>
          <View style={s.grid}>
            {chips.map((c) => (
              <TouchableOpacity key={c.key} style={[s.chip, open === c.key && s.chipOn]} onPress={() => setOpen(open === c.key ? null : c.key)} activeOpacity={0.7}>
                <Text style={[s.num, { color: c.names.length ? c.color : "#cbd5e1" }]}>{c.names.length}</Text>
                <Text style={s.label}>{c.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {opened && (
            <Text style={s.names}>{opened.names.length ? opened.names.join(", ") : `${opened.label} 인원이 없습니다.`}</Text>
          )}
          <Text style={s.muted}>오늘 지점 직원 {rows.length}명{data.attendanceHidden ? " · 출퇴근 열람 꺼짐(일정 · 휴가 기준)" : " · 지각 · 조퇴는 근무 중 · 퇴근과 겹쳐 셉니다"}{failed ? " · 새로 고치지 못했습니다(이전 숫자)" : ""}</Text>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 16, marginHorizontal: 16, marginBottom: 12, borderWidth: 1, borderColor: "#eef1f5" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  title: { fontSize: 16, fontWeight: "bold", color: "#111827" },
  link: { flexDirection: "row", alignItems: "center", gap: 2, padding: 4 },
  linkText: { fontSize: 13, color: "#4f46e5", fontWeight: "600" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { width: "22.5%", minWidth: 68, flexGrow: 1, alignItems: "center", paddingVertical: 10, borderRadius: 12, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#f1f5f9" },
  chipOn: { borderColor: "#c7d2fe", backgroundColor: "#eef2ff" },
  num: { fontSize: 20, fontWeight: "700" },
  label: { fontSize: 12, color: "#475569", marginTop: 2 },
  names: { fontSize: 13, color: "#334155", marginTop: 10, lineHeight: 19 },
  muted: { fontSize: 12, color: "#94a3b8", marginTop: 10 },
});
