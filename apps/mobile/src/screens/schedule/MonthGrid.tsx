import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { C } from "../../services/fmt";

/* 월 보기 달력 칸(#232 권경욱 원장 — 「앱에서도 캘린더를 월 단위 달력으로」, 디렉터 시안 = 아웃룩 월 보기).
   일~토 7칸 · 칸마다 3줄까지, 넘치면 「+N」. 칸을 누르면 아래에 그날 상세(onSelect) */

export type DayChip = { key: string; label: string; bg: string; fg: string; striped?: boolean };

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_CHIPS = 3;

export default function MonthGrid({ year, month, today, selected, onSelect, chipsOf, isRedDay }: {
  year: number;
  month: number;
  today: string;
  selected: string;
  onSelect: (ymd: string) => void;
  chipsOf: (ymd: string) => DayChip[];
  isRedDay: (ymd: string) => boolean;   // 일요일 · 공휴일 — 날짜 숫자를 빨강으로
}) {
  const mm = String(month).padStart(2, "0");
  const last = new Date(year, month, 0).getDate();
  const lead = new Date(year, month - 1, 1).getDay();   // 1일 앞 빈칸(일요일 시작)
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: last }, (_, i) => `${year}-${mm}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));

  return (
    <View style={s.wrap}>
      <View style={s.headRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={w} style={[s.headText, i === 0 && { color: "#e11d48" }, i === 6 && { color: C.blue }]}>{w}</Text>
        ))}
      </View>
      {weeks.map((wk, wi) => (
        <View key={wi} style={[s.weekRow, wi > 0 && s.weekLine]}>
          {wk.map((d, di) => {
            if (!d) return <View key={`e${di}`} style={[s.cell, s.cellEmpty]} />;
            const chips = chipsOf(d);
            const more = chips.length - MAX_CHIPS;
            const isToday = d === today;
            const isSel = d === selected;
            const red = di === 0 || isRedDay(d);
            return (
              <TouchableOpacity key={d} style={[s.cell, isSel && s.cellSel]} onPress={() => onSelect(d)} activeOpacity={0.6}>
                <View style={[s.num, isToday && s.numToday]}>
                  <Text style={[s.numText, red && { color: "#e11d48" }, di === 6 && !red && { color: C.blue }, isToday && { color: "#fff" }]}>{Number(d.slice(8, 10))}</Text>
                </View>
                {chips.slice(0, MAX_CHIPS).map((c) => (
                  <View key={c.key} style={[s.chip, { backgroundColor: c.bg }, c.striped && s.chipStriped]}>
                    <Text style={[s.chipText, { color: c.fg }]} numberOfLines={1}>{c.label}</Text>
                  </View>
                ))}
                {more > 0 && <Text style={s.more}>+{more}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: "hidden", marginHorizontal: 10, marginTop: 12 },
  headRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: "#f8fafc" },
  headText: { flex: 1, textAlign: "center", paddingVertical: 7, fontSize: 12, fontWeight: "600", color: C.sub },
  weekRow: { flexDirection: "row" },
  weekLine: { borderTopWidth: 1, borderTopColor: C.line },
  cell: { flex: 1, height: 100, overflow: "hidden", paddingHorizontal: 2, paddingTop: 3, paddingBottom: 4, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: C.line },
  cellEmpty: { backgroundColor: "#fafafa" },
  cellSel: { backgroundColor: C.indBg },
  num: { alignSelf: "center", minWidth: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  numToday: { backgroundColor: C.ind },
  numText: { fontSize: 12, fontWeight: "700", color: C.ink },
  chip: { borderRadius: 4, paddingHorizontal: 3, paddingVertical: 1.5, marginTop: 2 },
  chipStriped: { borderWidth: 1, borderStyle: "dashed", borderColor: C.amb },
  chipText: { fontSize: 10, fontWeight: "600" },
  more: { fontSize: 10, color: C.blue, fontWeight: "700", textAlign: "center", marginTop: 2 },
});
