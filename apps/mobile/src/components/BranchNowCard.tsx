import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking, Modal, ScrollView, Platform, StatusBar } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { getBranchDay, nowKindOf, type BranchDay, type BranchDayRow, type NowKind } from "../services/schedule";
import { LEAVE_LABELS } from "../services/leaveLabels";
import { C } from "../services/fmt";

// 홈 「오늘 근태」 · 「지점 근태」(원장 · 관리자). 2026-10-28 본부 이예지 앱 홈 S6 ②⑥:
//  · 네 칸 = 출근 · 지각 · 출근 전 · 휴가(같은 모양, 숫자 22 · 이름 12.5, 지각 칸 빨간 바탕 없음 — 빨강은 경고에만). 0 인 칸은 흐리게
//  · 아래 한 줄 「오늘 근무 N명 · 미출근 N명」(미출근은 대개 0이라 칸에서 뺐다, 1 이상이면 빨강)
//  · 홈에는 숫자만 — 칸을 누르면 「오늘 근태」 화면: 지각은 같은 출근 예정 시각끼리 묶어 이름 알약, 출근 전 · 휴가 · 미출근 한 줄씩
// 시각은 보이지 않게(■0-11) — 상태와 근무일정(「13:00 출근 예정」)만. 숫자는 웹 원장 대시보드와 같은 GET /api/schedule/day

type Tile = "ok" | "late" | "missing" | "leave";
type Bucket = Tile | "before";
type Tab = "all" | "late" | "before" | "leave" | "missing";
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const WD = ["일", "월", "화", "수", "목", "금", "토"];

export function tileOf(r: BranchDayRow, k: NowKind): Tile | "before" | null {
  if (k === "leave") return "leave";
  if (k === "missing" || k === "absent") return "missing";
  if (r.status === "LATE") return "late";
  if (k === "working" || k === "done" || k === "in") return "ok";
  if (k === "notYet") return "before";
  return null;   // 휴무 · 일정 없음 · 근무 예정(열람 꺼짐)
}

type Tiles = { key: Bucket; label: string; tab: Tab }[];
// 「출근」 칸에는 조퇴한 사람도 든다(출근은 했다) — 「정상 출근」이라 부르면 조퇴를 정상으로 읽는다(검증 B6)
const TILES: Tiles = [
  { key: "ok", label: "출근", tab: "all" }, { key: "late", label: "지각", tab: "late" }, { key: "before", label: "출근 전", tab: "before" }, { key: "leave", label: "휴가", tab: "leave" },
];

function TileRow({ by, onPressTile }: { by: Record<Bucket, BranchDayRow[]>; onPressTile?: (t: Tab) => void }) {
  return (
    <View style={s.grid}>
      {TILES.map((t) => {
        const cnt = by[t.key].length;
        return (
          <TouchableOpacity key={t.key} style={s.tile} activeOpacity={0.7} disabled={!onPressTile} onPress={() => onPressTile?.(t.tab)} accessibilityLabel={`${t.label} ${cnt}명`}>
            <Text style={[s.tLab, cnt === 0 && s.dim]}>{t.label}</Text>
            <Text style={[s.tNum, cnt === 0 && s.dim]}>{cnt}<Text style={s.tUnit}>명</Text></Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Pills({ list, showBranch, sub }: { list: BranchDayRow[]; showBranch: boolean; sub?: (r: BranchDayRow) => string }) {
  return (
    <View style={s.pills}>
      {list.map((r) => {
        const extra = sub ? sub(r) : showBranch && r.branch ? r.branch : "";
        return (
          <View key={r.id} style={s.pill}>
            <Text style={s.pillName}>{r.name}</Text>
            {!!extra && <Text style={s.pillSub}>{extra}</Text>}
          </View>
        );
      })}
    </View>
  );
}

function Section({ head, cnt, children }: { head: string; cnt: number; children: React.ReactNode }) {
  return (
    <View style={s.sec}>
      <View style={s.secHead}><Text style={s.secTitle}>{head}</Text><Text style={s.secCnt}>{cnt}명</Text></View>
      {children}
    </View>
  );
}

function LineRow({ label, list, onPress, extra, showBranch }: { label: string; list: BranchDayRow[]; onPress?: () => void; extra?: string; showBranch: boolean }) {
  return (
    <TouchableOpacity style={s.lineRow} activeOpacity={onPress ? 0.7 : 1} disabled={!onPress} onPress={onPress}>
      <Text style={s.lineLab}>{label}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={s.lineCnt}>{list.length}명</Text>
        {list.length > 0 && <Text style={s.lineSub} numberOfLines={2}>{extra ?? list.map((r) => (showBranch && r.branch ? `${r.name}(${r.branch})` : r.name)).join(" · ")}</Text>}
      </View>
      {!!onPress && <Ionicons name="chevron-forward" size={16} color={C.ind} />}
    </TouchableOpacity>
  );
}

// allBranches = 본부(전 지점) — 지점 이름을 붙이고 링크를 「지점별」로
export default function BranchNowCard({ reloadKey, onOpenSchedule, title, allBranches = false }: { reloadKey: number; onOpenSchedule: () => void; title: string; allBranches?: boolean }) {
  const [data, setData] = useState<BranchDay | null>(null);
  const [failed, setFailed] = useState(false);
  const [detail, setDetail] = useState<Tab | null>(null);   // 「오늘 근태」 화면(누른 칸)

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
  const dateText = `${n.getMonth() + 1}월 ${n.getDate()}일 (${WD[n.getDay()]})`;
  const by: Record<Bucket, BranchDayRow[]> = { ok: [], late: [], missing: [], leave: [], before: [] };
  for (const r of rows) { const t = tileOf(r, nowKindOf(r, nowHHmm)); if (t) by[t].push(r); }
  const planned = rows.filter((r) => r.status === "WORK").length;
  const hidden = !!data?.attendanceHidden;
  const todayWork = hidden ? planned + by.leave.length : by.ok.length + by.late.length + by.missing.length + by.leave.length + by.before.length;
  const whole = allBranches;
  const showBranch = whole || new Set(rows.map((r) => r.branch).filter(Boolean)).size > 1;
  const leaveName = (r: BranchDayRow) => (r.leaveType && LEAVE_LABELS[r.leaveType]) || "휴가";

  // 지각 — 같은 출근 예정 시각끼리(시각 없는 사람은 맨 뒤 「근무 예정」)
  const lateGroups = (() => {
    const m = new Map<string, BranchDayRow[]>();
    for (const r of by.late) { const k = r.startTime || ""; m.set(k, [...(m.get(k) ?? []), r]); }
    return [...m.entries()].sort(([a], [b]) => (a || "99").localeCompare(b || "99"));
  })();
  const leaveSummary = (() => {
    const m = new Map<string, number>();
    for (const r of by.leave) { const k = leaveName(r); m.set(k, (m.get(k) ?? 0) + 1); }
    return [...m.entries()].map(([k, v]) => `${k} ${v}`).join(" · ");
  })();
  const chips: { tab: Tab; label: string; cnt?: number }[] = [
    { tab: "all", label: "전체" }, { tab: "late", label: "지각", cnt: by.late.length }, { tab: "before", label: "출근 전", cnt: by.before.length },
    { tab: "leave", label: "휴가", cnt: by.leave.length }, ...(by.missing.length ? [{ tab: "missing" as Tab, label: "미출근", cnt: by.missing.length }] : []),
  ];

  return (
    <View style={s.wrap}>
      <View style={s.box}>
        <View style={s.head}>
          <Text style={s.title}>{title}</Text>
          <Text style={s.date}>{dateText}</Text>
          <TouchableOpacity onPress={onOpenSchedule} style={s.link} activeOpacity={0.7} accessibilityLabel="일정 보기">
            <Text style={s.linkText}>{whole ? "지점별" : "일정"}</Text>
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
              <View key={t.label} style={s.tile}><Text style={[s.tLab, t.n === 0 && s.dim]}>{t.label}</Text><Text style={[s.tNum, t.n === 0 && s.dim]}>{t.n}<Text style={s.tUnit}>명</Text></Text></View>
            ))}
          </View>
        ) : (
          <>
            <TileRow by={by} onPressTile={(t) => setDetail(t)} />
            <TouchableOpacity onPress={() => setDetail(by.missing.length ? "missing" : "all")} activeOpacity={0.7} accessibilityLabel="오늘 근태 자세히">
              <Text style={s.foot}>오늘 근무 {todayWork}명 · <Text style={by.missing.length ? s.footBad : undefined}>미출근 {by.missing.length}명</Text></Text>
            </TouchableOpacity>
            {failed && <Text style={s.muted}>새로 고치지 못했습니다(이전 숫자).</Text>}
          </>
        )}
      </View>

      {/* 「오늘 근태」 화면 — 시안 S6 오른쪽 끝. 모달로 열어 뒤로 가기 하나로 홈에 돌아온다(아래 탭에 가리지 않는다) */}
      <Modal visible={detail !== null} animationType="slide" statusBarTranslucent onRequestClose={() => setDetail(null)}>
        {/* 위 여백은 앱의 다른 전체 화면 창과 같은 값(iOS 상태 표시줄 · 노치) — SafeAreaProvider 가 없어 insets 훅을 쓰지 않는다 */}
        <View style={[s.dWrap, { paddingTop: Platform.OS === "ios" ? 54 : (StatusBar.currentHeight ?? 24) }]}>
          <View style={s.dHead}>
            <TouchableOpacity onPress={() => setDetail(null)} style={s.dBack} accessibilityLabel="뒤로">
              <Ionicons name="chevron-back" size={24} color={C.ink} />
            </TouchableOpacity>
            <Text style={s.dTitle}>{title}</Text>
            <View style={s.dBack} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 60, gap: 11 }}>
            <View style={s.box}>
              <View style={s.head}>
                <Text style={s.title}>{dateText}</Text>
                <Text style={[s.date, { marginLeft: "auto" }]}>근무 {todayWork}명</Text>
              </View>
              <TileRow by={by} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
              {chips.map((c) => (
                <TouchableOpacity key={c.tab} onPress={() => setDetail(c.tab)} style={[s.chip, detail === c.tab && s.chipOn]} activeOpacity={0.7}>
                  <Text style={[s.chipText, detail === c.tab && s.chipTextOn]}>{c.label}{c.cnt != null ? ` ${c.cnt}` : ""}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {(detail === "all" || detail === "late") && (
              by.late.length === 0 ? (detail === "late" ? <Text style={s.empty}>지각한 사람이 없습니다.</Text> : null) : (
                <View style={s.card}>
                  {lateGroups.map(([t, list], i) => (
                    <View key={t || "none"} style={i > 0 ? s.cardLine : undefined}>
                      <Section head={t ? `${t} 출근 예정` : "근무 예정"} cnt={list.length}><Pills list={list} showBranch={showBranch} /></Section>
                    </View>
                  ))}
                </View>
              )
            )}
            {(detail === "all" || detail === "missing") && by.missing.length > 0 && (
              <View style={s.card}>
                <Section head="미출근" cnt={by.missing.length}>
                  {by.missing.map((r) => (
                    <View key={r.id} style={s.missRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={s.missName} numberOfLines={1}>{r.name}{showBranch && r.branch ? ` · ${r.branch}` : ""}</Text>
                        <Text style={s.lineSub} numberOfLines={1}>{r.startTime ? `${r.startTime} 출근 예정 · 아직 안 옴` : "아직 안 옴"}</Text>
                      </View>
                      {!!r.phone && (
                        <TouchableOpacity style={s.call} onPress={() => Linking.openURL(`tel:${String(r.phone).replace(/[^0-9+]/g, "")}`).catch(() => {})} accessibilityLabel={`${r.name}에게 전화`}>
                          <Text style={s.callText}>전화</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </Section>
              </View>
            )}
            {detail === "missing" && by.missing.length === 0 && <Text style={s.empty}>미출근한 사람이 없습니다.</Text>}
            {detail === "all" && (
              <View style={s.card}>
                <LineRow label="출근" list={by.ok} showBranch={showBranch} />
                <View style={s.cardLine} />
                <LineRow label="출근 전" list={by.before} showBranch={showBranch} onPress={() => setDetail("before")} />
                <View style={s.cardLine} />
                <LineRow label="휴가" list={by.leave} showBranch={showBranch} extra={leaveSummary} onPress={() => setDetail("leave")} />
              </View>
            )}
            {detail === "before" && (by.before.length
              ? <View style={s.card}><Section head="출근 전" cnt={by.before.length}><Pills list={by.before} showBranch={showBranch} sub={(r) => [r.startTime ? `${r.startTime} 출근` : "", showBranch && r.branch ? r.branch : ""].filter(Boolean).join(" · ")} /></Section></View>
              : <Text style={s.empty}>출근 전인 사람이 없습니다.</Text>)}
            {detail === "leave" && (by.leave.length
              ? <View style={s.card}><Section head="휴가" cnt={by.leave.length}><Pills list={by.leave} showBranch={showBranch} sub={(r) => [leaveName(r), showBranch && r.branch ? r.branch : ""].filter(Boolean).join(" · ")} /></Section></View>
              : <Text style={s.empty}>오늘 휴가인 사람이 없습니다.</Text>)}

            <TouchableOpacity style={s.allBtn} onPress={() => { setDetail(null); onOpenSchedule(); }} activeOpacity={0.7}>
              <Text style={s.allBtnText}>{whole ? "지점별 일정 보기" : "지점 일정 보기"}</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginHorizontal: 14, marginBottom: 11 },
  box: { backgroundColor: C.indBg, borderRadius: 16, borderWidth: 1, borderColor: "#dfe5ff", padding: 14, gap: 10 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 16, fontWeight: "700", color: C.ink },
  date: { fontSize: 13, color: C.sub },
  link: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 2, minHeight: 36, paddingLeft: 8 },
  linkText: { fontSize: 13.5, fontWeight: "600", color: C.ind },
  grid: { flexDirection: "row", gap: 7 },
  tile: { flex: 1, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: C.line, paddingVertical: 10, paddingHorizontal: 6, minHeight: 64, alignItems: "center" },
  tLab: { fontSize: 12.5, fontWeight: "600", color: C.sub },
  tNum: { fontSize: 22, fontWeight: "800", color: C.ink, marginTop: 2 },
  tUnit: { fontSize: 12.5, fontWeight: "700" },
  dim: { color: "#a3adbb" },
  foot: { fontSize: 13.5, color: C.sub },
  footBad: { color: C.red, fontWeight: "700" },
  muted: { fontSize: 13, color: C.muted },
  // 「오늘 근태」 화면
  dWrap: { flex: 1, backgroundColor: C.bg },
  dHead: { flexDirection: "row", alignItems: "center", height: 52, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  dBack: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
  dTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "700", color: C.ink },
  chips: { gap: 7, paddingVertical: 2 },
  chip: { minHeight: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: "#fff", justifyContent: "center" },
  chipOn: { backgroundColor: C.ind, borderColor: C.ind },
  chipText: { fontSize: 14, fontWeight: "600", color: C.sub },
  chipTextOn: { color: "#fff" },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  cardLine: { borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  sec: { padding: 14, gap: 10 },
  secHead: { flexDirection: "row", alignItems: "center" },
  secTitle: { flex: 1, fontSize: 15, fontWeight: "700", color: C.ink },
  secCnt: { fontSize: 14, fontWeight: "600", color: C.sub },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  pill: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: "#fff" },
  pillName: { fontSize: 14.5, fontWeight: "700", color: C.ink },
  pillSub: { fontSize: 12.5, color: C.muted },
  lineRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13, minHeight: 56 },
  lineLab: { width: 60, fontSize: 14.5, fontWeight: "700", color: C.ink },
  lineCnt: { fontSize: 14.5, fontWeight: "700", color: C.ink },
  lineSub: { fontSize: 13, color: C.sub, marginTop: 2 },
  missRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 52 },
  missName: { fontSize: 14.5, fontWeight: "700", color: C.ink },
  call: { minWidth: 64, height: 40, borderRadius: 10, borderWidth: 1.5, borderColor: C.indBd, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  callText: { fontSize: 14, fontWeight: "700", color: C.ind },
  empty: { fontSize: 14, color: C.muted, textAlign: "center", paddingVertical: 18 },
  allBtn: { minHeight: 50, borderRadius: 14, borderWidth: 1.5, borderColor: C.indBd, backgroundColor: "#fff", alignItems: "center", justifyContent: "center", marginTop: 4 },
  allBtnText: { fontSize: 15, fontWeight: "700", color: C.ind },
});
