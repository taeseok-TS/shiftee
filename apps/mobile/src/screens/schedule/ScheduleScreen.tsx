import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ScheduleEntry, ScheduleRequest, LeaveRequest } from "@shiftee/api";
import * as api from "../../services/api";
import * as storage from "../../services/storage";
import { getWorkCalendar, createScheduleRequest, getHolidays, WorkCalendarEvent, Holiday } from "../../services/schedule";
import DatePicker from "../../components/DatePicker";

/* 근무 시간 템플릿 (웹 신청 페이지와 동일) */
const SCHEDULE_TEMPLATES = [
  { id: "8-5", name: "8-5 (8AM-5PM)", startTime: "08:00", endTime: "17:00", hours: 9 },
  { id: "9-6", name: "9-6 (9AM-6PM)", startTime: "09:00", endTime: "18:00", hours: 9 },
  { id: "10-7", name: "10-7 (10AM-7PM)", startTime: "10:00", endTime: "19:00", hours: 9 },
  { id: "11-8", name: "11-8 (11AM-8PM)", startTime: "11:00", endTime: "20:00", hours: 9 },
  { id: "12-9", name: "12-9 (12PM-9PM)", startTime: "12:00", endTime: "21:00", hours: 9 },
  { id: "1-10", name: "1-10 (1PM-10PM)", startTime: "13:00", endTime: "22:00", hours: 9 },
  { id: "9-5", name: "9-5 (9AM-5PM)", startTime: "09:00", endTime: "17:00", hours: 8 },
  { id: "10-6", name: "10-6 (10AM-6PM)", startTime: "10:00", endTime: "18:00", hours: 8 },
];

/* 휴게시간 (근로기준법: 4.5h+ → 30분, 9h+ → 1시간) — 웹과 동일 규칙 */
function breakHours(spanHours: number) {
  if (spanHours >= 9) return 1;
  if (spanHours >= 4.5) return 0.5;
  return 0;
}

/* 시간 직접 설정 → 템플릿 변환 (웹과 동일, 분은 00/30만) */
function buildCustomTemplate(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) return null;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return { id: "custom", name: `직접설정 (${start}~${end})`, startTime: start, endTime: end, hours };
}

/* 30분 단위 증감 (00:00 ~ 23:30 범위) */
function shiftHalfHour(t: string, delta: number) {
  const [h, m] = t.split(":").map(Number);
  let total = h * 60 + m + delta;
  if (total < 0) total = 0;
  if (total > 23 * 60 + 30) total = 23 * 60 + 30;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const LEAVE_TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차",
  SICK: "병가",
  PERSONAL: "개인휴가",
  MATERNITY: "출산휴가",
  BEREAVEMENT: "경조사",
  HALF_AM: "오전반차",
  HALF_PM: "오후반차",
  QUARTER_AM: "오전반반차",
  QUARTER_PM: "오후반반차",
  COMPENSATORY: "대체휴무",
  COMPENSATORY_HALF: "대체휴무반차",
};

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  work: { label: "근무", color: "#2563eb" },
  off: { label: "휴무", color: "#9ca3af" },
  holiday: { label: "휴일", color: "#ef4444" },
};

const REQ_STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: "대기중", color: "#f59e0b" },
  APPROVED: { label: "승인", color: "#10b981" },
  REJECTED: { label: "반려", color: "#ef4444" },
  CANCELLED: { label: "취소", color: "#9ca3af" },
};

export default function ScheduleScreen() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() + 1 };
  });
  const [shifts, setShifts] = useState<ScheduleEntry[]>([]);
  const [requests, setRequests] = useState<ScheduleRequest[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [events, setEvents] = useState<WorkCalendarEvent[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 근무일정 신청 모달
  const [reqOpen, setReqOpen] = useState(false);
  const [reqTemplate, setReqTemplate] = useState<(typeof SCHEDULE_TEMPLATES)[number] | null>(null);
  const [reqStart, setReqStart] = useState("");
  const [reqEnd, setReqEnd] = useState("");
  const [reqDays, setReqDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5])); // 기본 월~금
  const [reqSubmitting, setReqSubmitting] = useState(false);
  // 신청 기간의 공휴일 ("YYYY-MM-DD" → 이름). 위 holidays 는 달력 표시용으로 이번 달만 담겨 있어
  // 신청 기간 전체를 덮지 못한다 — 신청용으로 따로 조회한다(추석 연휴가 근무일로 잡히던 원인).
  const [reqHolidays, setReqHolidays] = useState<Record<string, string>>({});
  const [reqHolidayState, setReqHolidayState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // 시간 직접 설정 (주말 4.5시간 근무 등 — 30분 단위)
  const [customOn, setCustomOn] = useState(false);
  const [customStart, setCustomStart] = useState("09:00");
  const [customEnd, setCustomEnd] = useState("13:30");
  const changeCustom = (s: string, e: string) => {
    setCustomStart(s);
    setCustomEnd(e);
    const c = buildCustomTemplate(s, e);
    setReqTemplate(c); // 유효하지 않으면 null → 신청 버튼에서 막힘
  };

  useEffect(() => {
    storage.getUser().then((u) => setMyId(u?.id || "")).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, r, l, ev, hd] = await Promise.all([
        api.getMySchedules(cursor.year, cursor.month),
        api.getScheduleRequests(),
        api.getLeaveRequests(cursor.year, cursor.month),
        getWorkCalendar(cursor.year, cursor.month).catch(() => []),
        getHolidays(cursor.year).catch(() => []),
      ]);
      setShifts(s.sort((a, b) => a.date.localeCompare(b.date)));
      setRequests(r);
      setEvents(ev);
      // 이번 달 공휴일만 표시
      const mm = String(cursor.month).padStart(2, "0");
      setHolidays(hd.filter((h) => h.date.startsWith(`${cursor.year}-${mm}`)));
      // 관리자는 전체가 올 수 있어 본인 것만 표시
      setLeaves(myId ? l.filter((x) => x.userId === myId) : l);
    } catch (error) {
      console.error("❌ Failed to load schedule:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [cursor, myId]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const move = (delta: number) => {
    setLoading(true);
    setCursor((c) => {
      const m = c.month + delta;
      if (m < 1) return { year: c.year - 1, month: 12 };
      if (m > 12) return { year: c.year + 1, month: 1 };
      return { year: c.year, month: m };
    });
  };

  const fmtDay = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS[d.getDay()]})`;
  };

  // 신청 기간의 공휴일 조회 (기간이 연도를 넘길 수 있어 걸치는 연도를 모두 조회)
  useEffect(() => {
    if (!reqStart || !reqEnd || reqStart > reqEnd) { setReqHolidays({}); setReqHolidayState("idle"); return; }
    const y1 = Number(reqStart.slice(0, 4));
    const y2 = Number(reqEnd.slice(0, 4));
    if (!y1 || !y2 || y2 < y1) { setReqHolidays({}); setReqHolidayState("idle"); return; }
    const years: number[] = [];
    for (let y = y1; y <= y2; y++) years.push(y);

    let alive = true;
    setReqHolidays({});
    setReqHolidayState("loading");
    Promise.all(years.map((y) => getHolidays(y)))
      .then((results) => {
        if (!alive) return;
        const map: Record<string, string> = {};
        results.forEach((list) => (list || []).forEach((h) => { map[h.date] = h.name; }));
        setReqHolidays(map);
        setReqHolidayState("ready");
      })
      .catch(() => {
        if (!alive) return;
        setReqHolidays({});
        setReqHolidayState("error");
      });
    return () => { alive = false; };
  }, [reqStart, reqEnd]);

  // 신청 기간 × 선택 요일 → 근무 날짜 목록 (달력 날짜 기준, TZ 무관). 공휴일은 제외한다.
  const reqDates = useMemo(() => {
    if (!reqStart || !reqEnd || reqStart > reqEnd) return [] as string[];
    const out: string[] = [];
    const [sy, sm, sd] = reqStart.split("-").map(Number);
    const [ey, em, ed] = reqEnd.split("-").map(Number);
    const cur = new Date(sy, sm - 1, sd);
    const end = new Date(ey, em - 1, ed);
    while (cur <= end && out.length <= 62) {
      if (reqDays.has(cur.getDay())) {
        const mm = String(cur.getMonth() + 1).padStart(2, "0");
        const dd = String(cur.getDate()).padStart(2, "0");
        const ymd = `${cur.getFullYear()}-${mm}-${dd}`;
        if (!reqHolidays[ymd]) out.push(ymd); // 추석·설 등 공휴일은 근무일에서 뺀다
      }
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }, [reqStart, reqEnd, reqDays, reqHolidays]);

  // 기간 안에서 실제로 빠진 공휴일 (사용자에게 왜 줄었는지 알려준다)
  const reqExcludedHolidays = useMemo(() => {
    if (!reqStart || !reqEnd || reqStart > reqEnd) return [] as string[];
    return Object.keys(reqHolidays)
      .filter((d) => d >= reqStart && d <= reqEnd)
      .filter((d) => {
        const [y, m, dd] = d.split("-").map(Number);
        return reqDays.has(new Date(y, m - 1, dd).getDay());
      })
      .sort();
  }, [reqStart, reqEnd, reqDays, reqHolidays]);

  const reqNetDaily = reqTemplate ? Math.max(reqTemplate.hours - breakHours(reqTemplate.hours), 0) : 0;
  const reqTotalHours = Math.round(reqDates.length * reqNetDaily * 10) / 10;
  const reqHasWeekend = reqDates.some((d) => {
    const [y, m, dd] = d.split("-").map(Number);
    const dow = new Date(y, m - 1, dd).getDay();
    return dow === 0 || dow === 6;
  });

  const submitRequest = async () => {
    if (!reqTemplate || !reqStart || !reqEnd || reqDates.length === 0) {
      Alert.alert("알림", "근무 시간, 기간, 요일을 모두 선택해주세요.");
      return;
    }
    if (reqDates.length > 62) {
      Alert.alert("알림", "한 번에 최대 2개월까지 신청할 수 있습니다.");
      return;
    }
    setReqSubmitting(true);
    try {
      await createScheduleRequest({
        templateId: reqTemplate.id,
        templateName: reqTemplate.name,
        startDate: reqStart,
        endDate: reqEnd,
        scheduleData: reqDates.map((date) => ({ date, startTime: reqTemplate.startTime, endTime: reqTemplate.endTime })),
        totalHours: reqTotalHours,
      });
      setReqOpen(false);
      setReqTemplate(null);
      setCustomOn(false);
      setReqStart("");
      setReqEnd("");
      setReqDays(new Set([1, 2, 3, 4, 5]));
      Alert.alert("완료", "근무일정 신청이 접수되었습니다. 결재 승인 후 일정에 반영됩니다.");
      load();
    } catch (e: any) {
      Alert.alert("신청 실패", e?.response?.data?.error || "신청 중 오류가 발생했습니다.");
    } finally {
      setReqSubmitting(false);
    }
  };

  // 캘린더 일정 기간 표시 (같은 날이면 한 번만)
  const fmtEventRange = (ev: WorkCalendarEvent) => {
    const s = new Date(ev.startDate);
    const e = new Date(ev.endDate);
    const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    return f(s) === f(e) ? f(s) : `${f(s)} ~ ${f(e)}`;
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* 월 이동 헤더 */}
      <View style={styles.monthBar}>
        <TouchableOpacity onPress={() => move(-1)} style={styles.monthBtn}>
          <Ionicons name="chevron-back" size={22} color="#374151" />
        </TouchableOpacity>
        <Text style={styles.monthText}>
          {cursor.year}년 {cursor.month}월
        </Text>
        <TouchableOpacity onPress={() => move(1)} style={styles.monthBtn}>
          <Ionicons name="chevron-forward" size={22} color="#374151" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : (
        <>
          {/* 내 근무일정 */}
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>내 근무일정</Text>
              <TouchableOpacity style={styles.addReqBtn} onPress={() => setReqOpen(true)}>
                <Ionicons name="add" size={18} color="#fff" />
                <Text style={styles.addReqText}>일정 신청</Text>
              </TouchableOpacity>
            </View>
            {shifts.length === 0 ? (
              <Text style={styles.empty}>이 달에 등록된 일정이 없습니다.</Text>
            ) : (
              shifts.map((s) => {
                const t = TYPE_LABEL[s.type] || TYPE_LABEL.work;
                return (
                  <View key={s.id} style={styles.shiftItem}>
                    <Text style={styles.shiftDate}>{fmtDay(s.date)}</Text>
                    <View style={styles.shiftMid}>
                      {s.type === "work" ? (
                        <Text style={styles.shiftTime}>
                          {s.startTime} ~ {s.endTime}
                        </Text>
                      ) : (
                        <Text style={styles.shiftTime}>-</Text>
                      )}
                    </View>
                    <View style={[styles.badge, { backgroundColor: t.color }]}>
                      <Text style={styles.badgeText}>{t.label}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* 휴가 신청 내역 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>휴가 신청 내역</Text>
            {leaves.length === 0 ? (
              <Text style={styles.empty}>이 달 휴가 신청이 없습니다.</Text>
            ) : (
              leaves.map((l) => {
                const st = REQ_STATUS[l.status] || REQ_STATUS.PENDING;
                return (
                  <View key={l.id} style={styles.reqItem}>
                    <View style={styles.reqHeader}>
                      <Text style={styles.reqTitle} numberOfLines={1}>
                        {LEAVE_TYPE_LABEL[l.type] || l.type} · {l.days}일
                      </Text>
                      <View style={[styles.badge, { backgroundColor: st.color }]}>
                        <Text style={styles.badgeText}>{st.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.reqMeta}>
                      {String(l.startDate).slice(0, 10)} ~ {String(l.endDate).slice(0, 10)}
                      {l.reason ? ` · ${l.reason}` : ""}
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          {/* 일정 변경 신청 내역 */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>일정 변경 신청 내역</Text>
            {requests.length === 0 ? (
              <Text style={styles.empty}>신청 내역이 없습니다.</Text>
            ) : (
              requests.map((r) => {
                const st = REQ_STATUS[r.status] || REQ_STATUS.PENDING;
                return (
                  <View key={r.id} style={styles.reqItem}>
                    <View style={styles.reqHeader}>
                      <Text style={styles.reqTitle} numberOfLines={1}>
                        {r.templateName || "근무일정 신청"}
                      </Text>
                      <View style={[styles.badge, { backgroundColor: st.color }]}>
                        <Text style={styles.badgeText}>{st.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.reqMeta}>
                      {r.startDate} ~ {r.endDate} · {r.totalHours}시간
                    </Text>
                  </View>
                );
              })
            )}
            <Text style={styles.hint}>
              ℹ️ 위의 [일정 신청] 버튼으로 새 근무일정을 신청할 수 있습니다.
            </Text>
          </View>

          {/* 이번 달 공휴일 (관리자 > 공휴일 관리 데이터) */}
          {holidays.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>이번 달 공휴일</Text>
              {holidays.map((h) => (
                <View key={h.id} style={styles.eventItem}>
                  <View style={[styles.eventDot, { backgroundColor: "#ef4444" }]} />
                  <Text style={[styles.eventTitle, { color: "#dc2626", flex: 1 }]} numberOfLines={1}>{h.name}</Text>
                  <Text style={styles.eventDate}>{fmtDay(h.date)}</Text>
                </View>
              ))}
            </View>
          )}

          {/* 이번 달 전체 일정 (큐브티워크 캘린더 — 회사·지점 공통) */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>이번 달 전체 일정</Text>
            {events.length === 0 ? (
              <Text style={styles.empty}>등록된 일정이 없습니다.</Text>
            ) : (
              events.map((ev) => (
                <View key={ev.id} style={styles.eventItem}>
                  <View style={[styles.eventDot, { backgroundColor: ev.color || "#6366f1" }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle} numberOfLines={1}>{ev.title}</Text>
                    {!!ev.description && <Text style={styles.eventDesc} numberOfLines={2}>{ev.description}</Text>}
                  </View>
                  <View style={styles.eventRight}>
                    <Text style={styles.eventDate}>{fmtEventRange(ev)}</Text>
                    <Text style={[styles.eventBranch, ev.managersOnly && styles.eventManagers]}>
                      {ev.managersOnly ? "👑 원장" : ev.branch || "전사"}
                    </Text>
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      )}

      {/* 근무일정 신청 모달 */}
      <Modal visible={reqOpen} transparent animationType="slide" onRequestClose={() => setReqOpen(false)}>
        <KeyboardAvoidingView style={styles.reqBg} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.reqCard}>
            <Text style={styles.reqTitle2}>근무일정 신청</Text>
            <ScrollView style={{ maxHeight: 480 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.reqLabel}>근무 시간</Text>
              <View style={styles.tmplWrap}>
                {SCHEDULE_TEMPLATES.map((t) => (
                  <TouchableOpacity
                    key={t.id}
                    style={[styles.tmplChip, !customOn && reqTemplate?.id === t.id && styles.tmplChipOn]}
                    onPress={() => { setCustomOn(false); setReqTemplate(t); }}
                  >
                    <Text style={[styles.tmplChipText, !customOn && reqTemplate?.id === t.id && styles.tmplChipTextOn]}>{t.name}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  style={[styles.tmplChip, customOn && styles.tmplChipOn]}
                  onPress={() => { setCustomOn(true); setReqTemplate(buildCustomTemplate(customStart, customEnd)); }}
                >
                  <Text style={[styles.tmplChipText, customOn && styles.tmplChipTextOn]}>⚙️ 직접 설정</Text>
                </TouchableOpacity>
              </View>

              {/* 직접 설정: 30분 단위 출퇴근 시간 (주말 4.5시간 등) */}
              {customOn && (
                <View style={styles.customBox}>
                  <View style={styles.customRow}>
                    <Text style={styles.customLabel}>출근</Text>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => changeCustom(shiftHalfHour(customStart, -30), customEnd)}>
                      <Text style={styles.stepBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.customValue}>{customStart}</Text>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => changeCustom(shiftHalfHour(customStart, 30), customEnd)}>
                      <Text style={styles.stepBtnText}>＋</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.customRow}>
                    <Text style={styles.customLabel}>퇴근</Text>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => changeCustom(customStart, shiftHalfHour(customEnd, -30))}>
                      <Text style={styles.stepBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.customValue}>{customEnd}</Text>
                    <TouchableOpacity style={styles.stepBtn} onPress={() => changeCustom(customStart, shiftHalfHour(customEnd, 30))}>
                      <Text style={styles.stepBtnText}>＋</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={styles.customHours}>
                    {buildCustomTemplate(customStart, customEnd)
                      ? `${buildCustomTemplate(customStart, customEnd)!.hours}시간`
                      : "퇴근 시간이 출근 시간보다 빠릅니다"}
                  </Text>
                </View>
              )}

              <Text style={styles.reqLabel}>기간</Text>
              <View style={styles.dateRow}>
                <View style={{ flex: 1 }}>
                  <DatePicker value={reqStart} onChange={setReqStart} placeholder="시작일" />
                </View>
                <Text style={styles.dateTilde}>~</Text>
                <View style={{ flex: 1 }}>
                  <DatePicker value={reqEnd} onChange={setReqEnd} placeholder="종료일" minDate={reqStart || undefined} />
                </View>
              </View>

              <Text style={styles.reqLabel}>근무 요일</Text>
              <View style={styles.dayRow}>
                {WEEKDAYS.map((d, i) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.dayChip, reqDays.has(i) && styles.dayChipOn]}
                    onPress={() =>
                      setReqDays((prev) => {
                        const n = new Set(prev);
                        n.has(i) ? n.delete(i) : n.add(i);
                        return n;
                      })
                    }
                  >
                    <Text style={[styles.dayChipText, i === 0 && { color: "#ef4444" }, i === 6 && { color: "#2563eb" }, reqDays.has(i) && styles.dayChipTextOn]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {reqDates.length > 0 && reqTemplate && (
                <View style={styles.reqSummary}>
                  <Text style={styles.reqSummaryText}>
                    근무일 {reqDates.length}일 · 총 {reqTotalHours}시간 (일 {reqNetDaily}시간, 휴게 제외)
                  </Text>
                  {reqExcludedHolidays.length > 0 && (
                    <Text style={styles.reqHolidayNote}>
                      🎌 공휴일 {reqExcludedHolidays.length}일 제외 ({reqExcludedHolidays.map((d) => reqHolidays[d]).join(", ")})
                    </Text>
                  )}
                  {reqHolidayState === "error" && (
                    <Text style={styles.reqWeekendNote}>
                      ⚠️ 공휴일 정보를 불러오지 못했습니다. 연휴가 근무일로 포함될 수 있으니 날짜를 확인해주세요.
                    </Text>
                  )}
                  {reqHasWeekend && (
                    <Text style={styles.reqWeekendNote}>⚠️ 주말 근무 포함 — 승인 후 주말 출근이 가능해집니다.</Text>
                  )}
                </View>
              )}
            </ScrollView>

            <View style={styles.reqBtns}>
              <TouchableOpacity style={styles.reqCancel} onPress={() => setReqOpen(false)}>
                <Text style={styles.reqCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reqSubmit, (!reqTemplate || reqDates.length === 0) && { opacity: 0.5 }]}
                disabled={!reqTemplate || reqDates.length === 0 || reqSubmitting}
                onPress={submitRequest}
              >
                {reqSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.reqSubmitText}>신청</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { padding: 40, alignItems: "center" },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  monthBtn: { padding: 4 },
  monthText: { fontSize: 17, fontWeight: "bold", color: "#111827" },
  section: { padding: 16, paddingTop: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#111827", marginBottom: 10 },
  empty: { color: "#9ca3af", fontSize: 14, paddingVertical: 12 },
  hint: { color: "#9ca3af", fontSize: 12, marginTop: 10, lineHeight: 18 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  addReqBtn: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#2563eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  addReqText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  // 이번 달 전체 일정
  eventItem: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  eventDot: { width: 10, height: 10, borderRadius: 5 },
  eventTitle: { fontSize: 15, fontWeight: "600", color: "#111827" },
  eventDesc: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  eventRight: { alignItems: "flex-end" },
  eventDate: { fontSize: 13, color: "#374151", fontWeight: "500" },
  eventBranch: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  eventManagers: { color: "#b45309", fontWeight: "700" },
  // 근무일정 신청 모달
  reqBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  reqCard: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 28 },
  reqTitle2: { fontSize: 17, fontWeight: "bold", color: "#111827", marginBottom: 12 },
  reqLabel: { fontSize: 13, fontWeight: "600", color: "#6b7280", marginTop: 10, marginBottom: 6 },
  tmplWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  tmplChip: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: "#f9fafb" },
  tmplChipOn: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  tmplChipText: { fontSize: 13, color: "#374151" },
  tmplChipTextOn: { color: "#2563eb", fontWeight: "700" },
  // 시간 직접 설정 박스
  customBox: { borderWidth: 1, borderColor: "#2563eb", borderRadius: 10, padding: 12, marginTop: 8, gap: 8, backgroundColor: "#eff6ff" },
  customRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  customLabel: { fontSize: 13, color: "#6b7280", width: 30 },
  customValue: { fontSize: 17, fontWeight: "700", color: "#111827", width: 60, textAlign: "center" },
  stepBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center" },
  stepBtnText: { fontSize: 18, color: "#374151", lineHeight: 22 },
  customHours: { fontSize: 13, fontWeight: "600", color: "#2563eb" },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateTilde: { fontSize: 15, color: "#9ca3af" },
  dayRow: { flexDirection: "row", gap: 6 },
  dayChip: { flex: 1, height: 38, borderRadius: 8, borderWidth: 1, borderColor: "#e5e7eb", alignItems: "center", justifyContent: "center", backgroundColor: "#f9fafb" },
  dayChipOn: { borderColor: "#2563eb", backgroundColor: "#2563eb" },
  dayChipText: { fontSize: 14, color: "#374151", fontWeight: "600" },
  dayChipTextOn: { color: "#fff" },
  reqSummary: { marginTop: 14, backgroundColor: "#f0f9ff", borderRadius: 10, padding: 12 },
  reqSummaryText: { fontSize: 13, color: "#0369a1", fontWeight: "600" },
  reqWeekendNote: { fontSize: 12, color: "#b45309", marginTop: 4 },
  reqHolidayNote: { fontSize: 12, color: "#dc2626", marginTop: 4 },
  reqBtns: { flexDirection: "row", gap: 8, marginTop: 14 },
  reqCancel: { flex: 1, height: 48, borderRadius: 10, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  reqCancelText: { fontSize: 15, color: "#374151", fontWeight: "600" },
  reqSubmit: { flex: 1, height: 48, borderRadius: 10, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center" },
  reqSubmitText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  shiftItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  shiftDate: { width: 90, fontSize: 14, fontWeight: "600", color: "#111827" },
  shiftMid: { flex: 1 },
  shiftTime: { fontSize: 14, color: "#4b5563" },
  reqItem: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  reqHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reqTitle: { fontSize: 15, fontWeight: "600", color: "#111827", flex: 1, marginRight: 8 },
  reqMeta: { fontSize: 13, color: "#6b7280", marginTop: 6 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});
