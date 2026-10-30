import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, TextInput,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import DatePicker from "../../components/DatePicker";
import { getBranchStaff, getScheduleTemplates, bulkCreateSchedules, type ScheduleTemplate, type BranchStaff, type BulkScheduleResult } from "../../services/schedule";
import * as storage from "../../services/storage";
import { C, WEEKDAYS, addDaysYmd, dateOfYmd, fmtRange, fmtTime, stripTimes, todayYmd, weekOfYmd } from "../../services/fmt";

// 지점 근무일정 여러 날 한 번에 넣기(원장 · 본부, 2026-10-25 조혜련 원장 요청 「앱에서 원장이 지점 구성원 일정을 한 번에」).
// 웹 원장 화면 「여러 날 한 번에 넣기」(ScheduleBulkDialog)와 같은 서버(POST /api/schedule/bulk) · 같은 규칙.
// 위에서 아래: 직원 → 기간 → 요일 → 근무 시간(종류 또는 직접 입력) → 종류(근무 · 휴무) · 메모, 아래 고정 띠에 요약 + 「넣기」.
// 결과는 화면 안 상자(N건 넣었습니다 · 건너뛴 것 · 주 49시간 안내)로 보이고, 닫히면 지점 일정이 다시 불러온다.
// 색 규칙(■4): 실행 = 인디고, 토 · 일 회색 글자, 초록 · 이모지 없음. 누르는 자리 44px.

const MAX_DAYS = 93;            // 서버 상한(기간) — 서버는 differenceInDays(end, start) > 93 이라 양 끝 포함 94일까지 들어간다
const MAX_PEOPLE = 200;         // 서버 상한(인원)
const OFF_TIME = { start: "09:00", end: "18:00" };   // 휴무도 서버 규칙상 시간이 함께 저장된다 — 기본값으로 보낸다
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];   // 월~일(한 주 = 월~일)

/* 30분 단위 증감 (00:00 ~ 23:30) — 「근무 변경 요청」의 직접 입력과 같은 방식 */
function shiftHalfHour(t: string, delta: number) {
  const [h, m] = t.split(":").map(Number);
  let total = (h || 0) * 60 + (m || 0) + delta;
  if (total < 0) total = 0;
  if (total > 23 * 60 + 30) total = 23 * 60 + 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
/** 기간 날짜 수(양 끝 포함) — 시작 > 종료면 0 */
const daySpan = (a: string, b: string) => (a && b && a <= b ? Math.round((dateOfYmd(b).getTime() - dateOfYmd(a).getTime()) / 86400000) + 1 : 0);

/** 요일 묶음 글자 — 「월~금」 「월~금 · 토」 「월 · 수 · 금」 「매일」 */
function dowLabel(set: Set<number>) {
  if (set.size === 7) return "매일";
  const on = DOW_ORDER.filter((d) => set.has(d));
  const runs: number[][] = [];
  on.forEach((d) => {
    const last = runs[runs.length - 1];
    if (last && DOW_ORDER.indexOf(d) === DOW_ORDER.indexOf(last[last.length - 1]) + 1) last.push(d);
    else runs.push([d]);
  });
  return runs.map((r) => (r.length >= 3 ? `${WEEKDAYS[r[0]]}~${WEEKDAYS[r[r.length - 1]]}` : r.map((d) => WEEKDAYS[d]).join(" · "))).join(" · ");
}

type Props = {
  visible: boolean;
  /** 본부(관리자) — 직원을 지점별로 묶어 보인다 */
  showBranch?: boolean;
  /** 닫기 — didInsert 가 true 면 일정을 넣었으니 지점 일정을 다시 불러와야 한다 */
  onClose: (didInsert: boolean) => void;
};

export default function BranchScheduleBulkScreen({ visible, showBranch = false, onClose }: Props) {
  // 직원 · 근무 시간 종류
  const [people, setPeople] = useState<BranchStaff[]>([]);
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // 기간 — 기본 다음 주 월~일(열릴 때마다 그날 기준으로 다시 센다 — 마운트 때 한 번 고정하면 날이 바뀐 뒤 지난 주가 남는다, 검증 4)
  const nextWeekOf = (today: string) => { const w = weekOfYmd(today); return { start: addDaysYmd(w.start, 7), end: addDaysYmd(w.end, 7) }; };
  const [start, setStart] = useState(() => nextWeekOf(todayYmd()).start);
  const [end, setEnd] = useState(() => nextWeekOf(todayYmd()).end);
  // 요일 — 기본 월~금
  const [dows, setDows] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]));
  // 근무 시간 — 종류를 고르면 채워지고, 직접 고치면 「직접 입력」
  const [tplId, setTplId] = useState<string>("custom");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("19:00");
  // 종류 · 메모
  const [kind, setKind] = useState<"WORK" | "OFF">("WORK");
  const [note, setNote] = useState("");
  // 보내기 · 결과
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);   // 빠르게 두 번 누르면 두 번 들어가던 것 — state 는 다음 렌더에야 바뀌어서 ref 로 즉시 막는다
  const [result, setResult] = useState<BulkScheduleResult | null>(null);
  const [submitError, setSubmitError] = useState("");
  const seq = useRef(0);

  const load = useCallback(async () => {
    const my = ++seq.current;
    setLoading(true); setLoadError("");
    try {
      // 웹 원장 화면과 같은 /api/employees(원장은 담당 지점, 관리자는 전 지점 · 재직 + 휴직, 테스트 계정 포함). 근무 시간 종류는 없어도 된다(직접 입력만)
      const [staff, tpls, me] = await Promise.all([getBranchStaff(), getScheduleTemplates().catch(() => [] as ScheduleTemplate[]), storage.getUser().catch(() => null)]);
      if (my !== seq.current) return;
      const list = staff.slice();
      // 원장 본인도 넣을 수 있다(웹 본부 답변 #7) — 지점이 비어 목록에 없으면 맨 앞에 붙인다. 본부(ADMIN)는 넣지 않는다
      if (me?.id && me.role === "MANAGER" && !list.some((p) => p.id === me.id)) list.unshift({ id: me.id, name: `${me.name} (본인)`, position: null, branch: null, isTest: false });
      setPeople(list.sort((a, b) => (a.branch || "").localeCompare(b.branch || "", "ko") || a.name.localeCompare(b.name, "ko")));
      setTemplates(tpls);
      if (tpls.length > 0) { setTplId(tpls[0].id); setStartTime(tpls[0].startTime); setEndTime(tpls[0].endTime); }
    } catch {
      if (my !== seq.current) return;
      setLoadError("직원 목록을 불러오지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, []);

  // 열릴 때마다 새로 — 지난번 고른 것은 남기지 않는다
  useEffect(() => {
    if (!visible) return;
    setPicked(new Set()); setDows(new Set([1, 2, 3, 4, 5])); setKind("WORK"); setNote("");
    const nw = nextWeekOf(todayYmd()); setStart(nw.start); setEnd(nw.end);
    setTplId("custom"); setStartTime("10:00"); setEndTime("19:00");
    setResult(null); setSubmitError("");
    load();
  }, [visible, load]);

  // 직원 묶음(본부는 지점별)
  const groups = useMemo(() => {
    if (!showBranch) return [{ title: "", list: people }];
    const map = new Map<string, BranchStaff[]>();
    people.forEach((p) => { const k = p.branch || "지점 없음"; map.set(k, [...(map.get(k) || []), p]); });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ko")).map(([title, list]) => ({ title, list }));
  }, [people, showBranch]);
  const allPicked = people.length > 0 && picked.size === people.length;
  const toggleOne = (id: string) => setPicked((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setPicked(allPicked ? new Set() : new Set(people.map((p) => p.id)));
  const toggleGroup = (list: BranchStaff[]) => setPicked((prev) => {
    const n = new Set(prev);
    const every = list.every((p) => n.has(p.id));
    list.forEach((p) => (every ? n.delete(p.id) : n.add(p.id)));
    return n;
  });

  // 시간 — 종류 고르기 · 직접 고치기
  const pickTemplate = (t: ScheduleTemplate) => { setTplId(t.id); setStartTime(t.startTime); setEndTime(t.endTime); };
  const changeTime = (s: string, e: string) => { setTplId("custom"); setStartTime(s); setEndTime(e); };
  const minutes = toMin(endTime) - toMin(startTime);
  const hours = Math.round((minutes / 60) * 10) / 10;
  const isOff = kind === "OFF";
  // 휴무면 시간은 기본값(09:00–18:00)으로 보내므로 시간 오류가 넣기를 막지 않는다(검증 5)
  const timeError = isOff ? "" : minutes <= 0 ? "종료 시간이 시작 시간보다 빠릅니다" : minutes > 12 * 60 ? "하루 근무는 12시간을 넘을 수 없습니다" : "";

  // 기간 · 요일 → 날짜 수(달력 날짜 기준). 상한은 서버와 같게 — 날짜 차이(span − 1)가 93 을 넘으면 거절(양 끝 포함 94일까지, 검증 2)
  const span = daySpan(start, end);
  const tooLong = span - 1 > MAX_DAYS;
  const dateCount = useMemo(() => {
    if (!span || tooLong || dows.size === 0) return 0;
    let n = 0;
    for (let i = 0; i < span; i++) if (dows.has(dateOfYmd(addDaysYmd(start, i)).getDay())) n++;
    return n;
  }, [start, span, tooLong, dows]);
  const rangeError = !start || !end ? "기간을 골라 주세요" : start > end ? "시작일이 종료일보다 늦습니다" : tooLong ? `기간은 최대 3개월(${MAX_DAYS}일)까지입니다 — 지금 ${span}일` : "";

  const canSubmit = !loading && !loadError && picked.size > 0 && picked.size <= MAX_PEOPLE && !rangeError && dows.size > 0 && dateCount > 0 && !timeError && !busy;
  const summary = [
    `${picked.size}명`,
    start && end && start <= end ? fmtRange(start, end) : "기간",
    dows.size ? dowLabel(dows) : "요일",
    kind === "OFF" ? "휴무" : fmtTime(startTime, endTime),
  ].join(" · ");

  const submit = async () => {
    if (!canSubmit || busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setSubmitError("");
    try {
      const r = await bulkCreateSchedules({
        userIds: [...picked], startDate: start, endDate: end, weekdays: [...dows].sort(),
        startTime: isOff ? OFF_TIME.start : startTime, endTime: isOff ? OFF_TIME.end : endTime, type: kind, ...(note.trim() ? { note: note.trim() } : {}),
      });
      setResult(r);
    } catch (e: any) {
      setSubmitError(e?.response?.data?.error || "넣지 못했습니다. 연결을 확인하고 다시 시도해 주세요.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const close = () => onClose(!!result && result.count > 0);

  const skippedLine = result
    ? [result.skippedExisting ? `이미 일정 있는 날 ${result.skippedExisting}` : "", result.skippedLeave ? `휴가 ${result.skippedLeave}` : "", result.skippedHoliday ? `공휴일 ${result.skippedHoliday}` : ""].filter(Boolean).join(" · ")
    : "";

  return (
    // iOS 시트를 아래로 끌어 내리면 onRequestClose 없이 사라져 visible 과 어긋난다 — onDismiss 때 아직 visible 이면 끌어 닫은 것
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close} onDismiss={() => { if (visible) close(); }}>
      <KeyboardAvoidingView style={s.wrap} behavior="padding">
        {/* 머리 — iOS 는 시트로 띄운다(전체 화면이면 상태바가 닫기 버튼을 가린다) */}
        <View style={s.head}>
          <Text style={s.title}>근무일정 추가</Text>
          <TouchableOpacity style={s.closeBtn} onPress={close} accessibilityLabel="닫기">
            <Ionicons name="close" size={24} color="#374151" />
          </TouchableOpacity>
        </View>

        {result ? (
          /* 결과 상자 — 닫으면 지점 일정이 다시 불러온다 */
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body}>
            <View style={s.resultBox}>
              <Text style={s.resultTitle}>{result.count > 0 ? `${result.count}건 넣었습니다` : "넣은 일정이 없습니다"}</Text>
              <Text style={s.resultSub}>{summary}</Text>
              {!!skippedLine && <Text style={s.resultLine}>건너뜀 — {skippedLine}</Text>}
              {result.count === 0 && !skippedLine && <Text style={s.resultLine}>고른 기간 · 요일에 넣을 날이 없습니다.</Text>}
              {result.warnings.length > 0 && (
                <View style={s.warnBox}>
                  {result.warnings.map((w, i) => <Text key={i} style={s.warnText}>{w}</Text>)}
                </View>
              )}
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
            {/* 직원 */}
            <View style={s.secHead}>
              <Text style={s.secTitle}>직원 <Text style={s.secCount}>{picked.size}명</Text></Text>
              {people.length > 0 && (
                <TouchableOpacity style={s.linkBtn} onPress={toggleAll}>
                  <Text style={s.linkText}>{allPicked ? "모두 해제" : "모두 선택"}</Text>
                </TouchableOpacity>
              )}
            </View>
            {loading ? (
              <ActivityIndicator color={C.ind} style={{ marginVertical: 24 }} />
            ) : loadError ? (
              <View style={s.card}>
                <Text style={s.errText}>{loadError}</Text>
                <TouchableOpacity style={s.ghostBtn} onPress={load}><Text style={s.ghostText}>다시 불러오기</Text></TouchableOpacity>
              </View>
            ) : people.length === 0 ? (
              <View style={s.card}><Text style={s.mutedText}>지점 직원이 없습니다.</Text></View>
            ) : (
              groups.map((g) => {
                const every = g.list.every((p) => picked.has(p.id));
                return (
                  <View key={g.title || "all"} style={{ marginBottom: 10 }}>
                    {!!g.title && (
                      <TouchableOpacity style={s.groupHead} onPress={() => toggleGroup(g.list)}>
                        <Ionicons name={every ? "checkbox" : "square-outline"} size={22} color={every ? C.ind : "#94a3b8"} />
                        <Text style={s.groupTitle}>{g.title} <Text style={s.secCount}>{g.list.filter((p) => picked.has(p.id)).length}/{g.list.length}명</Text></Text>
                      </TouchableOpacity>
                    )}
                    <View style={s.lst}>
                      {g.list.map((p, i) => {
                        const on = picked.has(p.id);
                        return (
                          <TouchableOpacity key={p.id} style={[s.row, i > 0 && s.rowLine, on && s.rowOn]} onPress={() => toggleOne(p.id)} activeOpacity={0.7}>
                            <Ionicons name={on ? "checkbox" : "square-outline"} size={22} color={on ? C.ind : "#94a3b8"} />
                            <Text style={s.rowName} numberOfLines={1}>{p.name}</Text>
                            {p.isTest && <Text style={s.testTag}>테스트</Text>}
                            {!!p.position && p.position !== "-" && <Text style={s.rowSub} numberOfLines={1}>{p.position}</Text>}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })
            )}
            {picked.size > MAX_PEOPLE && <Text style={s.errText}>한 번에 {MAX_PEOPLE}명까지 넣을 수 있습니다.</Text>}

            {/* 기간 */}
            <Text style={s.secTitle}>기간</Text>
            <View style={s.dateRow}>
              <View style={{ flex: 1 }}><DatePicker value={start} onChange={(d) => { setStart(d); if (end && d > end) setEnd(d); }} placeholder="시작일" /></View>
              <Text style={s.tilde}>~</Text>
              <View style={{ flex: 1 }}><DatePicker value={end} onChange={setEnd} placeholder="종료일" minDate={start || undefined} /></View>
            </View>
            {rangeError ? <Text style={s.errText}>{rangeError}</Text> : <Text style={s.hint}>{span}일 중 고른 요일 {dateCount}일</Text>}

            {/* 요일 — 월~일, 토 · 일은 회색 글자 */}
            <Text style={s.secTitle}>요일</Text>
            <View style={s.dowRow}>
              {DOW_ORDER.map((d) => {
                const on = dows.has(d);
                const we = d === 0 || d === 6;
                return (
                  <TouchableOpacity key={d} style={[s.dowChip, on && s.dowChipOn]} onPress={() => setDows((prev) => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; })}>
                    <Text style={[s.dowText, we && { color: C.weekend }, on && s.dowTextOn]}>{WEEKDAYS[d]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {dows.size === 0 && <Text style={s.errText}>요일을 하나 이상 골라 주세요.</Text>}

            {/* 근무 시간 — 종류 칩 + 직접 입력. 휴무면 접고 안내 한 줄(검증 5) */}
            <Text style={s.secTitle}>근무 시간</Text>
            {isOff ? (
              <Text style={s.hint}>휴무도 서버 규칙상 시간이 함께 저장됩니다 — 기본 {OFF_TIME.start}–{OFF_TIME.end}</Text>
            ) : templates.length > 0 ? (
              <View style={s.chipWrap}>
                {templates.map((t) => (
                  <TouchableOpacity key={t.id} style={[s.chip, tplId === t.id && s.chipOn]} onPress={() => pickTemplate(t)}>
                    <Text style={[s.chipText, tplId === t.id && s.chipTextOn]}>{stripTimes(t.name) || t.name} {fmtTime(t.startTime, t.endTime)}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity style={[s.chip, tplId === "custom" && s.chipOn]} onPress={() => setTplId("custom")}>
                  <Text style={[s.chipText, tplId === "custom" && s.chipTextOn]}>직접 입력</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={s.hint}>등록된 근무 시간 종류가 없어 직접 입력합니다.</Text>
            )}
            {!isOff && <View style={[s.timeBox, tplId === "custom" && s.timeBoxCustom]}>
              <View style={s.timeRow}>
                <Text style={s.timeLabel}>시작</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => changeTime(shiftHalfHour(startTime, -30), endTime)} accessibilityLabel="시작 30분 앞으로"><Text style={s.stepText}>−</Text></TouchableOpacity>
                <Text style={s.timeValue}>{startTime}</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => changeTime(shiftHalfHour(startTime, 30), endTime)} accessibilityLabel="시작 30분 뒤로"><Text style={s.stepText}>＋</Text></TouchableOpacity>
              </View>
              <View style={s.timeRow}>
                <Text style={s.timeLabel}>종료</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => changeTime(startTime, shiftHalfHour(endTime, -30))} accessibilityLabel="종료 30분 앞으로"><Text style={s.stepText}>−</Text></TouchableOpacity>
                <Text style={s.timeValue}>{endTime}</Text>
                <TouchableOpacity style={s.stepBtn} onPress={() => changeTime(startTime, shiftHalfHour(endTime, 30))} accessibilityLabel="종료 30분 뒤로"><Text style={s.stepText}>＋</Text></TouchableOpacity>
              </View>
              <Text style={[s.timeHours, !!timeError && { color: C.red }]}>{timeError || `${hours}시간`}</Text>
            </View>}

            {/* 종류 · 메모 */}
            <Text style={s.secTitle}>종류</Text>
            <View style={s.chipWrap}>
              {([["WORK", "근무"], ["OFF", "휴무"]] as const).map(([k, label]) => (
                <TouchableOpacity key={k} style={[s.chip, kind === k && s.chipOn]} onPress={() => setKind(k)}>
                  <Text style={[s.chipText, kind === k && s.chipTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={s.secTitle}>메모 <Text style={s.secCount}>선택</Text></Text>
            <TextInput style={s.input} value={note} onChangeText={setNote} maxLength={100} placeholder="예: 11월 시간표" placeholderTextColor="#9ca3af" />

            <Text style={s.foot}>이미 일정이 있는 날 · 승인된 휴가인 날{kind === "WORK" ? " · 공휴일" : ""}은 건너뜁니다.</Text>
            {!!submitError && <Text style={[s.errText, { marginTop: 8 }]}>{submitError}</Text>}
          </ScrollView>
        )}

        {/* 아래 고정 띠 — 요약 한 줄 + 넣기(결과 뒤에는 닫기) */}
        <View style={s.dock}>
          {!result && <Text style={s.dockSummary} numberOfLines={2}>{summary}</Text>}
          {result ? (
            <TouchableOpacity style={s.dockBtn} onPress={close}><Text style={s.dockBtnText}>닫기</Text></TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.dockBtn, !canSubmit && { opacity: 0.45 }]} disabled={!canSubmit} onPress={submit} accessibilityLabel="넣기">
              {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.dockBtnText}>넣기</Text>}
            </TouchableOpacity>
          )}
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
  secHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  secTitle: { fontSize: 14, fontWeight: "700", color: C.sub, marginTop: 14, marginBottom: 6 },
  secCount: { color: C.ind, fontWeight: "800" },
  linkBtn: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8, marginTop: 8 },
  linkText: { fontSize: 14, fontWeight: "700", color: C.ind },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 14, gap: 8 },
  errText: { fontSize: 13, color: C.red, marginTop: 6, lineHeight: 18 },
  mutedText: { fontSize: 14, color: C.muted },
  hint: { fontSize: 13, color: C.muted, marginTop: 6 },
  ghostBtn: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: "#fff" },
  ghostText: { fontSize: 13.5, color: C.gray, fontWeight: "700" },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, paddingHorizontal: 4 },
  groupTitle: { fontSize: 15, fontWeight: "700", color: C.ink },
  lst: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, minHeight: 52 },
  rowLine: { borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  rowOn: { backgroundColor: "#f7f8ff" },
  rowName: { fontSize: 15, fontWeight: "700", color: C.ink, flexShrink: 1 },
  rowSub: { fontSize: 13, color: C.muted, flexShrink: 1 },
  testTag: { fontSize: 11, color: C.muted, backgroundColor: C.grayBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tilde: { fontSize: 15, color: "#9ca3af", marginBottom: 12 },
  dowRow: { flexDirection: "row", gap: 6 },
  dowChip: { flex: 1, height: 44, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: "center", justifyContent: "center", backgroundColor: "#fff" },
  dowChipOn: { borderColor: C.ind, backgroundColor: C.ind },
  dowText: { fontSize: 14, color: "#374151", fontWeight: "700" },
  dowTextOn: { color: "#fff" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: C.line, backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 14 },
  chipOn: { backgroundColor: C.ind, borderColor: C.ind },
  chipText: { fontSize: 13.5, fontWeight: "700", color: C.gray },
  chipTextOn: { color: "#fff" },
  timeBox: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginTop: 8, gap: 8, backgroundColor: "#fff" },
  timeBoxCustom: { borderColor: C.indBd, backgroundColor: C.indBg },
  timeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  timeLabel: { fontSize: 13.5, color: C.sub, width: 32, fontWeight: "700" },
  timeValue: { fontSize: 18, fontWeight: "800", color: C.ink, width: 64, textAlign: "center" },
  stepBtn: { width: 44, height: 44, borderRadius: 10, backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center" },
  stepText: { fontSize: 20, color: "#374151", lineHeight: 24 },
  timeHours: { fontSize: 13.5, fontWeight: "700", color: C.ind },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15, color: C.ink, backgroundColor: "#fff", minHeight: 44 },
  foot: { fontSize: 13, color: C.muted, marginTop: 14, lineHeight: 19 },
  dock: { backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 14, paddingTop: 10, paddingBottom: Platform.OS === "ios" ? 26 : 12, gap: 8 },
  dockSummary: { fontSize: 13.5, fontWeight: "700", color: C.indInk },
  dockBtn: { height: 48, borderRadius: 12, backgroundColor: C.ind, alignItems: "center", justifyContent: "center" },
  dockBtnText: { color: "#fff", fontSize: 16, fontWeight: "800" },
  resultBox: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, gap: 6 },
  resultTitle: { fontSize: 18, fontWeight: "800", color: C.ink },
  resultSub: { fontSize: 13.5, color: C.sub },
  resultLine: { fontSize: 14, color: C.ink, marginTop: 4 },
  warnBox: { backgroundColor: C.ambBg, borderWidth: 1, borderColor: C.ambBd, borderRadius: 10, padding: 10, marginTop: 6, gap: 4 },
  warnText: { fontSize: 13.5, color: C.amb, lineHeight: 19 },
});
