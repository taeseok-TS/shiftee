import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Modal } from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  value: string; // "YYYY-MM-DD" 또는 ""
  onChange: (date: string) => void;
  placeholder?: string;
  minDate?: string; // 이 날짜 이전은 선택 불가
  disabled?: boolean;
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");
const toStr = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export default function DatePicker({ value, onChange, placeholder = "날짜 선택", minDate, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const initial = value ? new Date(value) : today;
  const [view, setView] = useState({
    year: isNaN(initial.getTime()) ? today.getFullYear() : initial.getFullYear(),
    month: isNaN(initial.getTime()) ? today.getMonth() : initial.getMonth(),
  });

  const cells = useMemo(() => {
    const first = new Date(view.year, view.month, 1).getDay(); // 1일의 요일(0=일)
    const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
    const arr: (number | null)[] = [];
    for (let i = 0; i < first; i++) arr.push(null);
    for (let d = 1; d <= daysInMonth; d++) arr.push(d);
    return arr;
  }, [view]);

  // 7칸씩 주 단위 행으로 분할. flexWrap+%너비는 기기 픽셀 반올림에 따라 한 줄에 6칸만
  // 들어가 날짜가 어긋나므로, 명시적 7칸 행으로 렌더한다.
  const weeks = useMemo(() => {
    const arr = [...cells];
    while (arr.length % 7 !== 0) arr.push(null);
    const out: (number | null)[][] = [];
    for (let i = 0; i < arr.length; i += 7) out.push(arr.slice(i, i + 7));
    return out;
  }, [cells]);

  const openModal = () => {
    if (disabled) return;
    const base = value ? new Date(value) : new Date();
    setView({ year: base.getFullYear(), month: base.getMonth() });
    setOpen(true);
  };

  const move = (delta: number) => {
    setView((v) => {
      const m = v.month + delta;
      const year = v.year + Math.floor(m / 12);
      const month = ((m % 12) + 12) % 12;
      return { year, month };
    });
  };

  const isDisabled = (d: number) => {
    if (!minDate) return false;
    return toStr(view.year, view.month, d) < minDate;
  };

  const select = (d: number) => {
    if (isDisabled(d)) return;
    onChange(toStr(view.year, view.month, d));
    setOpen(false);
  };

  return (
    <>
      <TouchableOpacity style={[styles.field, disabled && styles.fieldDisabled]} onPress={openModal} activeOpacity={0.7}>
        <Text style={[styles.fieldText, !value && styles.placeholder]}>{value || placeholder}</Text>
        <Ionicons name="calendar-outline" size={18} color="#6b7280" />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.calendar} onPress={() => {}}>
            {/* 헤더: 연월 + 이동 */}
            <View style={styles.header}>
              <TouchableOpacity style={styles.navBtn} onPress={() => move(-1)}>
                <Ionicons name="chevron-back" size={22} color="#374151" />
              </TouchableOpacity>
              <Text style={styles.headerText}>{view.year}년 {view.month + 1}월</Text>
              <TouchableOpacity style={styles.navBtn} onPress={() => move(1)}>
                <Ionicons name="chevron-forward" size={22} color="#374151" />
              </TouchableOpacity>
            </View>

            {/* 요일 */}
            <View style={styles.weekRow}>
              {WEEKDAYS.map((w, i) => (
                <Text key={w} style={[styles.weekday, i === 0 && styles.sun, i === 6 && styles.sat]}>{w}</Text>
              ))}
            </View>

            {/* 날짜 그리드 — 주 단위 7칸 행 */}
            <View>
              {weeks.map((week, wi) => (
                <View key={`w${wi}`} style={styles.weekLine}>
                  {week.map((d, dow) => {
                    if (d === null) return <View key={`b${wi}-${dow}`} style={styles.cell} />;
                    const dateStr = toStr(view.year, view.month, d);
                    const selected = dateStr === value;
                    const off = isDisabled(d);
                    return (
                      <TouchableOpacity key={dateStr} style={styles.cell} onPress={() => select(d)} disabled={off}>
                        <View style={[styles.dayWrap, selected && styles.daySelected]}>
                          <Text
                            style={[
                              styles.dayText,
                              dow === 0 && styles.sun,
                              dow === 6 && styles.sat,
                              off && styles.dayOff,
                              selected && styles.daySelectedText,
                            ]}
                          >
                            {d}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  fieldDisabled: { opacity: 0.6 },
  fieldText: { fontSize: 14, color: "#1f2937" },
  placeholder: { color: "#9ca3af" },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  calendar: { backgroundColor: "#fff", borderRadius: 14, padding: 16 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  headerText: { fontSize: 16, fontWeight: "700", color: "#111827" },
  navBtn: { padding: 6 },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontSize: 12, color: "#6b7280", marginBottom: 6 },
  weekLine: { flexDirection: "row" },
  cell: { flex: 1, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  dayWrap: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  daySelected: { backgroundColor: "#2563eb" },
  dayText: { fontSize: 15, color: "#1f2937" },
  daySelectedText: { color: "#fff", fontWeight: "700" },
  dayOff: { color: "#d1d5db" },
  sun: { color: "#ef4444" },
  sat: { color: "#2563eb" },
});
