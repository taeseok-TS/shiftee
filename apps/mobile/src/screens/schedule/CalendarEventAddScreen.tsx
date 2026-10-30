import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput,
  KeyboardAvoidingView, Platform, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DatePicker from "../../components/DatePicker";
import { createWorkCalendarEvent, getCalendarNotes } from "../../services/schedule";
import { C, todayYmd } from "../../services/fmt";

// 캘린더 일정 넣기(회의 등 지점 일정, #236 권경욱 원장 2026-10-30) — 일정 탭 「일정 넣기」.
// 웹 큐브티워크 캘린더 「일정 추가」와 같은 서버(POST /api/work/calendar) · 같은 규칙:
//  · 원장 = 「지점」(내 대표 지점 — 서버가 정한다) 또는 「원장」(전 원장 대상, 지점 없음)
//  · 본부 = 「전사」 · 「원장」 · 「지점」(지점을 고른다)
//  · 시각은 선택 — 「종일」이면 비워 보낸다(#221). 같은 날이면 끝이 시작보다 늦어야 한다(서버도 본다)
// 근무일정(여러 날 · 여러 명)은 출퇴근 탭 「근무일정 추가」(BranchScheduleBulkScreen)로 옮겼다.
// 색 규칙(■4): 실행 = 인디고, 이모지 없음. 누르는 자리 44px.

type Kind = "branch" | "managers" | "company";

/* 30분 단위 증감 (00:00 ~ 23:30) — 근무일정 추가 화면과 같은 방식 */
function shiftHalfHour(t: string, delta: number) {
  const [h, m] = t.split(":").map(Number);
  let total = (h || 0) * 60 + (m || 0) + delta;
  if (total < 0) total = 0;
  if (total > 23 * 60 + 30) total = 23 * 60 + 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

type Props = {
  visible: boolean;
  /** "ADMIN" | "MANAGER" — 고를 수 있는 캘린더가 다르다 */
  role: string;
  /** 원장의 대표 지점(라벨용, 서버가 이 지점으로 넣는다) */
  myBranch: string | null;
  /** 닫기 — didInsert 가 true 면 넣었으니 달력을 다시 불러온다 */
  onClose: (didInsert: boolean) => void;
};

export default function CalendarEventAddScreen({ visible, role, myBranch, onClose }: Props) {
  const isAdmin = role === "ADMIN";
  const [kind, setKind] = useState<Kind>(isAdmin ? "company" : "branch");
  const [branches, setBranches] = useState<string[]>([]);   // 본부가 「지점」을 고를 때
  const [branch, setBranch] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(todayYmd());
  const [end, setEnd] = useState(todayYmd());
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("11:00");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);   // 빠르게 두 번 누르면 두 번 들어가지 않게 — state 는 다음 렌더에야 바뀐다
  const [error, setError] = useState("");

  // 열릴 때마다 처음 상태로(날짜는 그날 기준)
  useEffect(() => {
    if (!visible) return;
    const t = todayYmd();
    setKind(isAdmin ? "company" : "branch");
    setTitle(""); setStart(t); setEnd(t); setAllDay(true); setStartTime("10:00"); setEndTime("11:00"); setMemo(""); setError("");
  }, [visible, isAdmin]);
  // 본부 — 고를 수 있는 지점 목록(지점 공유와 같은 범위)
  useEffect(() => {
    if (!visible || !isAdmin || branches.length) return;
    getCalendarNotes(todayYmd().slice(0, 7)).then((r) => { setBranches(r.branches); setBranch((b) => b ?? r.branches[0] ?? null); }).catch(() => {});
  }, [visible, isAdmin, branches.length]);

  const sameDay = start === end;
  const timeError = !allDay && sameDay && endTime <= startTime ? "끝 시각은 시작 시각보다 늦어야 합니다." : "";
  const branchMissing = (kind === "branch" && isAdmin && !branch) || (kind === "branch" && !isAdmin && !myBranch);
  const canSubmit = !!title.trim() && !!start && !!end && start <= end && !timeError && !branchMissing && !busy;

  const kinds: [Kind, string][] = isAdmin
    ? [["company", "전사"], ["managers", "원장"], ["branch", "지점"]]
    : [["branch", myBranch ? `지점 · ${myBranch}` : "지점"], ["managers", "원장"]];
  const kindHint = kind === "company" ? "전 직원에게 보입니다." : kind === "managers" ? "원장 · 본부에게만 보입니다." : "그 지점 구성원에게 보입니다.";

  async function submit() {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    try {
      await createWorkCalendarEvent({
        title: title.trim(),
        description: memo.trim() || undefined,
        startDate: start,
        endDate: end,
        startTime: allDay ? null : startTime,
        endTime: allDay ? null : endTime,
        managersOnly: kind === "managers",
        branch: isAdmin && kind === "branch" ? branch : null,
      });
      onClose(true);
      // 시트가 닫힌 뒤에 띄운다 — 아이폰은 닫히는 모달 위 알림이 함께 사라질 수 있다(10/30 검증)
      setTimeout(() => Alert.alert("일정을 넣었습니다", "「내 일정」 달력에서 볼 수 있습니다."), 450);
    } catch (e: any) {
      setError(e?.response?.data?.error || "일정을 넣지 못했습니다. 잠시 뒤 다시 해 주세요.");
    } finally {
      busyRef.current = false; setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => onClose(false)} onDismiss={() => { if (visible) onClose(false); }}>
      <KeyboardAvoidingView style={s.wrap} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <View style={s.head}>
          <Text style={s.title}>일정 넣기</Text>
          <TouchableOpacity style={s.closeBtn} onPress={() => onClose(false)} accessibilityLabel="닫기">
            <Ionicons name="close" size={24} color={C.gray} />
          </TouchableOpacity>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          {/* 캘린더 */}
          <Text style={s.secTitle}>캘린더</Text>
          <View style={s.chipWrap}>
            {kinds.map(([k, label]) => (
              <TouchableOpacity key={k} style={[s.chip, kind === k && s.chipOn]} onPress={() => setKind(k)}>
                <Text style={[s.chipText, kind === k && s.chipTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {isAdmin && kind === "branch" && (
            branches.length ? (
              <View style={[s.chipWrap, { marginTop: 8 }]}>
                {branches.map((b) => (
                  <TouchableOpacity key={b} style={[s.chip, branch === b && s.chipOn]} onPress={() => setBranch(b)}>
                    <Text style={[s.chipText, branch === b && s.chipTextOn]}>{b}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : <ActivityIndicator color={C.ind} style={{ marginVertical: 12 }} />
          )}
          <Text style={s.hint}>{!isAdmin && kind === "branch" && !myBranch ? "소속 지점이 없어 지점 일정을 넣을 수 없습니다." : kindHint}</Text>

          {/* 제목 */}
          <Text style={s.secTitle}>제목</Text>
          <TextInput style={s.input} value={title} onChangeText={setTitle} maxLength={100} placeholder="예: 월례 회의" placeholderTextColor="#9ca3af" />

          {/* 날짜 */}
          <Text style={s.secTitle}>날짜</Text>
          <View style={s.dateRow}>
            <View style={{ flex: 1 }}><DatePicker value={start} onChange={(d) => { setStart(d); if (end && d > end) setEnd(d); }} placeholder="시작일" /></View>
            <Text style={s.tilde}>~</Text>
            <View style={{ flex: 1 }}><DatePicker value={end} onChange={setEnd} placeholder="종료일" minDate={start || undefined} /></View>
          </View>

          {/* 시각 — 종일이 기본 */}
          <Text style={s.secTitle}>시각</Text>
          <View style={s.chipWrap}>
            {([[true, "종일"], [false, "시각 지정"]] as const).map(([v, label]) => (
              <TouchableOpacity key={label} style={[s.chip, allDay === v && s.chipOn]} onPress={() => setAllDay(v)}>
                <Text style={[s.chipText, allDay === v && s.chipTextOn]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          {!allDay && (
            <View style={s.timeBox}>
              <View style={s.timeRow}>
                <Text style={s.timeLabel}>시작</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => setStartTime(shiftHalfHour(startTime, -30))} accessibilityLabel="시작 30분 앞으로"><Text style={s.stepText}>−</Text></TouchableOpacity>
                <Text style={s.timeValue}>{startTime}</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => setStartTime(shiftHalfHour(startTime, 30))} accessibilityLabel="시작 30분 뒤로"><Text style={s.stepText}>＋</Text></TouchableOpacity>
              </View>
              <View style={s.timeRow}>
                <Text style={s.timeLabel}>끝</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => setEndTime(shiftHalfHour(endTime, -30))} accessibilityLabel="끝 30분 앞으로"><Text style={s.stepText}>−</Text></TouchableOpacity>
                <Text style={s.timeValue}>{endTime}</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => setEndTime(shiftHalfHour(endTime, 30))} accessibilityLabel="끝 30분 뒤로"><Text style={s.stepText}>＋</Text></TouchableOpacity>
              </View>
              {!!timeError && <Text style={s.errText}>{timeError}</Text>}
            </View>
          )}

          {/* 메모 */}
          <Text style={s.secTitle}>메모 <Text style={s.secCount}>선택</Text></Text>
          <TextInput style={[s.input, { minHeight: 80, textAlignVertical: "top" }]} value={memo} onChangeText={setMemo} maxLength={500} multiline placeholder="장소 · 준비물 등" placeholderTextColor="#9ca3af" />

          <Text style={s.foot}>고치기 · 지우기는 PC(cubetee.co.kr) 큐브티워크 캘린더에서 합니다.</Text>
          {!!error && <Text style={[s.errText, { marginTop: 8 }]}>{error}</Text>}
        </ScrollView>

        <View style={s.dock}>
          <TouchableOpacity style={[s.dockBtn, !canSubmit && { opacity: 0.45 }]} disabled={!canSubmit} onPress={submit} accessibilityLabel="넣기">
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.dockBtnText}>넣기</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: C.bg },
  head: { flexDirection: "row", alignItems: "center", paddingLeft: 16, paddingRight: 6, minHeight: 52, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  title: { flex: 1, fontSize: 17, fontWeight: "800", color: C.ink },
  closeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  body: { padding: 14, paddingBottom: 24 },
  secTitle: { fontSize: 14, fontWeight: "700", color: C.sub, marginTop: 14, marginBottom: 6 },
  secCount: { color: C.ind, fontWeight: "800" },
  errText: { fontSize: 13, color: C.red, marginTop: 6, lineHeight: 18 },
  hint: { fontSize: 13, color: C.muted, marginTop: 6 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tilde: { fontSize: 15, color: "#9ca3af", marginBottom: 12 },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: C.line, backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 14 },
  chipOn: { backgroundColor: C.ind, borderColor: C.ind },
  chipText: { fontSize: 13.5, fontWeight: "700", color: C.gray },
  chipTextOn: { color: "#fff" },
  timeBox: { borderWidth: 1, borderColor: C.indBd, borderRadius: 12, padding: 12, marginTop: 8, gap: 8, backgroundColor: C.indBg },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  timeLabel: { fontSize: 13.5, color: C.sub, width: 32, fontWeight: "700" },
  timeValue: { fontSize: 18, fontWeight: "800", color: C.ink, width: 64, textAlign: "center" },
  stepBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 20, color: "#374151", lineHeight: 24 },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: C.ink, backgroundColor: "#fff", minHeight: 44 },
  foot: { fontSize: 13, color: C.muted, marginTop: 14, lineHeight: 19 },
  dock: { backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 14, paddingTop: 10, paddingBottom: Platform.OS === "ios" ? 26 : 12 },
  dockBtn: { height: 48, borderRadius: 12, backgroundColor: C.ind, alignItems: "center", justifyContent: "center" },
  dockBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
});
