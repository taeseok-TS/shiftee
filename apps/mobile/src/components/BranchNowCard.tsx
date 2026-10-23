import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { getBranchDay, nowKindOf, type BranchDay, type BranchDayRow, type NowKind } from "../services/schedule";
import { LEAVE_LABELS } from "../services/leaveLabels";
import { C } from "../services/fmt";

// 홈 「오늘 ○○ 근태」(원장 · 관리자, 2026-10-23 본부 요청 앱 7 · 시안 S2-1).
// 겹치지 않는 4칸 — 출근(조퇴 포함) · 지각 · 미출근 · 휴가(합 = 오늘 근무 인원, 아직 출근 시각 전인 사람은 「출근 전 N명」으로 따로).
// 시각은 보이지 않게(■0-11) — 상태와 근무일정(「13:00 출근 예정」)만. 미출근 · 지각은 아래 줄에 이름, 미출근은 「전화」(번호가 오면).
// 숫자는 웹 원장 대시보드와 같은 GET /api/schedule/day 에서 — 홈을 다시 보거나 당겨서 새로 고칠 때마다 다시 읽는다

type Tile = "ok" | "late" | "missing" | "leave";
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function tileOf(r: BranchDayRow, k: NowKind): Tile | "before" | null {
  if (k === "leave") return "leave";
  if (k === "missing" || k === "absent") return "missing";
  if (r.status === "LATE") return "late";
  if (k === "working" || k === "done" || k === "in") return "ok";
  if (k === "notYet") return "before";
  return null;   // 휴무 · 일정 없음 · 근무 예정(열람 꺼짐)
}

export default function BranchNowCard({ reloadKey, onOpenSchedule, title, max = 5 }: { reloadKey: number; onOpenSchedule: () => void; title: string; max?: number }) {
  const [data, setData] = useState<BranchDay | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Tile | null>(null);

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
  const by: Record<Tile | "before", BranchDayRow[]> = { ok: [], late: [], missing: [], leave: [], before: [] };
  for (const r of rows) { const t = tileOf(r, nowKindOf(r, nowHHmm)); if (t) by[t].push(r); }
  const planned = rows.filter((r) => r.status === "WORK").length;
  const hidden = !!data?.attendanceHidden;
  const todayWork = hidden ? planned + by.leave.length : by.ok.length + by.late.length + by.missing.length + by.leave.length + by.before.length;
  const tiles: { key: Tile; label: string; bad?: boolean }[] = [
    // 「출근」 칸에는 조퇴한 사람도 든다(출근은 했다) — 「정상 출근」이라 부르면 조퇴를 정상으로 읽는다(검증 B6)
    { key: "ok", label: "출근" }, { key: "late", label: "지각", bad: true }, { key: "missing", label: "미출근", bad: true }, { key: "leave", label: "휴가" },
  ];
  const problems = [...by.missing.map((r) => ({ r, k: "미출근" as const })), ...by.late.map((r) => ({ r, k: "지각" as const }))];
  const opened = open ? by[open] : null;

  return (
    <View style={s.wrap}>
      <View style={s.head}>
        <Text style={s.title}>{title}</Text>
        <TouchableOpacity onPress={onOpenSchedule} style={s.link} activeOpacity={0.7} accessibilityLabel="지점 일정 보기">
          <Text style={s.headSub}>오늘 근무 {todayWork}명{by.before.length ? ` · 출근 전 ${by.before.length}명` : ""}</Text>
          <Ionicons name="chevron-forward" size={14} color={C.ind} />
        </TouchableOpacity>
      </View>
      {failed && !data ? (
        <Text style={s.muted}>불러오지 못했습니다. 아래로 당겨 다시 시도해 주세요.</Text>
      ) : !data ? (
        <Text style={s.muted}>불러오는 중…</Text>
      ) : hidden ? (
        <View style={s.grid}>
          {[{ label: "근무 예정", n: planned }, { label: "휴가", n: by.leave.length }].map((t) => (
            <View key={t.label} style={s.tile}><Text style={s.tLab}>{t.label}</Text><Text style={s.tNum}>{t.n}<Text style={s.tUnit}>명</Text></Text></View>
          ))}
        </View>
      ) : (
        <>
          <View style={s.grid}>
            {tiles.map((t) => {
              const cnt = by[t.key].length;
              const bad = t.bad && cnt > 0;
              return (
                <TouchableOpacity key={t.key} style={[s.tile, bad && s.tileBad, open === t.key && s.tileOn]} activeOpacity={0.7} onPress={() => setOpen(open === t.key ? null : t.key)}>
                  <Text style={[s.tLab, bad && { color: "#9f1239" }]}>{t.label}</Text>
                  <Text style={[s.tNum, bad && { color: C.red }]}>{cnt}<Text style={s.tUnit}>명</Text></Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {opened && (open === "ok" || open === "leave") && (
            <Text style={s.names}>{opened.length ? opened.map((r) => (open === "leave" && r.leaveType ? `${r.name}(${LEAVE_LABELS[r.leaveType] || "휴가"})` : r.name)).join(", ") : "없습니다."}</Text>
          )}
          {problems.length > 0 && (
            <View style={s.lst}>
              {problems.slice(0, max).map(({ r, k }, i) => (
                <View key={r.id} style={[s.it, i > 0 && s.itLine]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.itName} numberOfLines={1}>{r.name} · {k}{r.branch && title.includes("전체") ? ` (${r.branch})` : ""}</Text>
                    <Text style={s.itSub} numberOfLines={1}>{r.startTime ? `${r.startTime} 출근 예정` : "근무 예정"}{k === "미출근" ? " · 아직 안 옴" : ""}</Text>
                  </View>
                  {k === "미출근" && !!r.phone && (
                    <TouchableOpacity style={s.call} onPress={() => Linking.openURL(`tel:${String(r.phone).replace(/[^0-9+]/g, "")}`).catch(() => {})} accessibilityLabel={`${r.name}에게 전화`}>
                      <Text style={s.callText}>전화</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {problems.length > max && (
                <TouchableOpacity style={[s.it, s.itLine]} onPress={onOpenSchedule}>
                  <Text style={s.more}>{problems.length - max}명 더 보기 ›</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
          {failed && <Text style={s.muted}>새로 고치지 못했습니다(이전 숫자).</Text>}
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 14, marginBottom: 12, gap: 8 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 16, fontWeight: "700", color: C.ink },
  link: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 44, paddingLeft: 8 },
  headSub: { fontSize: 13.5, color: C.sub },
  grid: { flexDirection: "row", gap: 7 },
  tile: { flex: 1, backgroundColor: "#fff", borderRadius: 14, borderWidth: 1, borderColor: C.line, paddingVertical: 10, paddingHorizontal: 9, minHeight: 64 },
  tileBad: { backgroundColor: C.redBg, borderColor: C.redBd },
  tileOn: { borderColor: C.indBd },
  tLab: { fontSize: 12.5, fontWeight: "600", color: C.sub },
  tNum: { fontSize: 22, fontWeight: "800", color: C.ink, marginTop: 2 },
  tUnit: { fontSize: 12, fontWeight: "700" },
  names: { fontSize: 13.5, color: "#334155", lineHeight: 19 },
  lst: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  it: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 11, minHeight: 56 },
  itLine: { borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  itName: { fontSize: 14.5, fontWeight: "700", color: C.ink },
  itSub: { fontSize: 13.5, color: C.sub, marginTop: 2 },
  call: { minWidth: 64, height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: C.indBd, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  callText: { fontSize: 14, fontWeight: "700", color: C.ind },
  more: { fontSize: 13.5, color: C.sub },
  muted: { fontSize: 13, color: C.muted },
});
