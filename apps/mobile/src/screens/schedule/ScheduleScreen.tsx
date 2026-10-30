import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LEAVE_LABELS, isPartialLeave } from "../../services/leaveLabels";
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
  } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ScheduleEntry, ScheduleRequest, LeaveRequest } from "@shiftee/api";
import * as api from "../../services/api";
import * as storage from "../../services/storage";
import { getScheduleTemplates, ScheduleTemplate, getWorkCalendar, createScheduleRequest, getHolidays, cancelMyScheduleRequest, WorkCalendarEvent, Holiday, getMySchedulesRange, getMyCalendarUnit, setMyCalendarUnit, getMyPermissions, type CalendarUnit } from "../../services/schedule";
import DatePicker from "../../components/DatePicker";
import BranchDayView from "../../components/BranchDayView";
import BranchScheduleBulkScreen from "./BranchScheduleBulkScreen";
import MonthGrid, { type DayChip } from "./MonthGrid";
import BranchShareView from "./BranchShareView";
import { useNavigation, useRoute } from "@react-navigation/native";
import { C, fmtDay as fmtDayLong, fmtShort as fmtShortD, fmtTime, isWeekend, stripTimes, wd } from "../../services/fmt";

/* 근무 시간 템플릿 — 본부가 관리하는 템플릿 표에서 받는다(2026-10-07 QA #10, 웹 신청과 같은 목록) */

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
  return { id: "custom", name: `직접 입력 (${start}–${end})`, startTime: start, endTime: end, hours };
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
const EV_FILTER_LABEL = { all: "전체", company: "전사", branch: "지점", managers: "원장" } as const;

/* 달력 보기 단위(2026-10-12 QA #81) — 월(종전) · 주(월~일) · 일. 날짜 계산은 달력 날짜 문자열로(TZ 무관) */
const UNIT_LABEL: Record<CalendarUnit, string> = { month: "월", week: "주", day: "일" };
const ymdOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dateOf = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (ymd: string, n: number) => { const d = dateOf(ymd); d.setDate(d.getDate() + n); return ymdOf(d); };
const weekOf = (ymd: string) => { const d = dateOf(ymd); const back = (d.getDay() + 6) % 7; const start = addDays(ymd, -back); return { start, end: addDays(start, 6) }; };
const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

const LEAVE_TYPE_LABEL: Record<string, string> = LEAVE_LABELS;   // 공용 객체 — syncLeaveLabels 가 본부 유형 이름을 채운다(#216-1)

const TYPE_LABEL: Record<string, { label: string; color: string }> = {
  work: { label: "근무", color: "#2563eb" },
  off: { label: "휴무", color: "#9ca3af" },
  holiday: { label: "휴일", color: "#ef4444" },
};

// 대기 = 주황 알약, 승인 = 파랑, 반려 = 빨강(초록 금지, 2026-10-23 ■4)
const REQ_STATUS: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: "승인 대기", color: "#b45309", bg: "#fffbeb" },
  APPROVED: { label: "승인", color: "#1e40af", bg: "#dbeafe" },
  REJECTED: { label: "반려", color: "#be123c", bg: "#fff1f2" },
  CANCELLED: { label: "취소함", color: "#475569", bg: "#f1f5f9" },
};

export default function ScheduleScreen() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() + 1 };
  });
  const [shifts, setShifts] = useState<ScheduleEntry[]>([]);
  // 보기 단위(#81)와 기준 날짜 — 주·일 보기는 기준 날짜의 주/그 날, 월 보기는 cursor 의 달
  const [unit, setUnitState] = useState<CalendarUnit>("week");
  const [focusDay, setFocusDay] = useState(() => ymdOf(new Date()));
  useEffect(() => { getMyCalendarUnit().then(setUnitState).catch(() => {}); }, []);
  const setUnit = (u: CalendarUnit) => { setUnitState(u); setMyCalendarUnit(u); };
  const loadSeq = useRef(0);   // 늦게 온 옛 조회(월↔주 전환·빠른 이동)가 화면을 덮지 않게(#81 검증 1)
  const period = unit === "week" ? weekOf(focusDay) : unit === "day" ? { start: focusDay, end: focusDay } : null;
  const [requests, setRequests] = useState<ScheduleRequest[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [events, setEvents] = useState<WorkCalendarEvent[]>([]);
  const [holidays, setHolidays] = useState<Holiday[]>([]);         // 이번 달(목록 섹션용)
  const [holidaysAll, setHolidaysAll] = useState<Holiday[]>([]);   // 보기 기간이 걸친 해 전부(주 띠·일 보기용, #81 검증 2)
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // 내 일정 / 지점 일정(원장 · 관리자, 2026-10-23 조혜련 원장 문의) — 홈 「현재 근무 상황」 › 지점 일정 으로도 들어온다
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const [role, setRole] = useState<string | null>(null);
  const [myBranch, setMyBranch] = useState<string | null>(null);   // 「지점에 공유」 사본과 원본이 겹칠 때 하나만 보이게(#230)
  const [view, setView] = useState<"mine" | "branch" | "share">("mine");   // share = 이달의 지점 공유(#234, 전 직원)
  // 지점 일정(큐브티워크 캘린더) 종류 거르기 — 웹 캘린더 상단 필터와 같은 기준(#234). 원장 전용은 원장 · 관리자에게만 온다
  const [evFilter, setEvFilter] = useState<"all" | "company" | "branch" | "managers">("all");
  const [evPickOpen, setEvPickOpen] = useState(false);
  // 다른 곳을 건드리면(탭 · 보기 단위 · 달 · 날짜) 드롭다운은 닫는다(드롭다운 규칙 — 바깥을 누르면 닫힘)
  useEffect(() => { setEvPickOpen(false); }, [view, unit, cursor, focusDay]);
  useEffect(() => { storage.getUser().then((u) => setRole(u?.role || "")).catch(() => setRole("")); }, []);
  // 로그인 때 저장한 내 정보에는 지점이 없다(로그인 응답 = id · 이름 · 메일 · 역할) — 지점은 프로필에서 읽는다(#235 권경욱: 앱 전체 보기에 사본 · 원본이 둘 다 보임).
  // 못 읽으면 다음 불러오기(달 이동 · 당겨서 새로 고침) 때 다시
  const branchLoaded = useRef(false);
  const wantBranch = route.params?.view === "branch";
  useEffect(() => {
    if (!wantBranch) return;
    setView("branch");
    navigation.setParams({ view: undefined });   // 한 번만 — 다음에 탭을 누르면 마지막에 본 쪽 그대로
  }, [wantBranch, navigation]);
  const staff = role === "ADMIN" || role === "MANAGER";
  // 지점 일정 「일정 넣기」(원장 · 본부, 2026-10-25 조혜련 원장 요청) — 넣고 닫히면 reloadKey 를 올려 BranchDayView 가 다시 읽는다
  const [bulkOpen, setBulkOpen] = useState(false);
  const [branchReloadKey, setBranchReloadKey] = useState(0);
  // 「원장 근무일정 직접 편집」 권한(#39)이 꺼지면 웹처럼 버튼을 숨긴다(실제 차단은 서버 403). 본부는 늘 보임. 못 읽으면 보이고 서버 문구에 맡긴다
  const [canBulk, setCanBulk] = useState(true);
  useEffect(() => {
    if (role !== "MANAGER") return;
    let alive = true;
    getMyPermissions().then((p) => { if (alive) setCanBulk(p["manager.editSchedule"] !== false); }).catch(() => {});
    return () => { alive = false; };
  }, [role]);

  // 근무일정 신청 모달
  const [reqOpen, setReqOpen] = useState(false);
  const [reqTemplate, setReqTemplate] = useState<ScheduleTemplate | null>(null);
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  useEffect(() => {
    getScheduleTemplates().then(setTemplates).catch(() => {});
  }, []);
  const [reqStart, setReqStart] = useState("");
  const [reqEnd, setReqEnd] = useState("");
  const [reqDays, setReqDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5])); // 기본 월~금
  const [reqSubmitting, setReqSubmitting] = useState(false);
  // 빠르게 두 번 누르면 두 번 신청되던 것 — state 는 다음 렌더에야 바뀌어서, 누르는 즉시 ref 로 막는다(끝나면 푼다)
  const reqBusyRef = useRef(false);
  const delBusyRef = useRef(false);
  // 기존 일정 수정 요청이면 그 날짜(2026-10-07 #49) — 신청 창을 그 날 하루로 열고 kind=UPDATE 로 보낸다
  const [updateDate, setUpdateDate] = useState<string | null>(null);
  // 신청 창 닫기 — 수정 요청이었다면 그 하루·요일이 다음 「일정 신청」에 남지 않게 되돌린다
  const closeReq = () => {
    setReqOpen(false);
    if (updateDate) {
      setUpdateDate(null);
      setReqStart("");
      setReqEnd("");
      setReqDays(new Set([1, 2, 3, 4, 5]));
    }
  };
  const [cancelingId, setCancelingId] = useState("");
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
    const seq = ++loadSeq.current;
    if (!branchLoaded.current) api.getMyProfile().then((p) => { branchLoaded.current = true; setMyBranch(p?.branch ?? null); }).catch(() => {});
    try {
      // 공휴일은 보기 기간이 걸친 해를 모두(연말 주는 두 해)
      const years = [...new Set([cursor.year, ...(period ? [Number(period.start.slice(0, 4)), Number(period.end.slice(0, 4))] : [])])];
      const [s, r, l, ev, hdList] = await Promise.all([
        period ? getMySchedulesRange(period.start, period.end) : api.getMySchedules(cursor.year, cursor.month),
        api.getScheduleRequests(),
        api.getLeaveRequests(),   // 내 휴가 전부 — 달을 걸치는 주도 날짜 칸에 연차가 보이게(10/23 앱 6)
        // 지점 일정은 보기 기간이 걸친 달을 모두(주가 두 달에 걸치면 둘 다 — 월 이동 뒤 주로 바꾸면 앞달 일정이 비던 것, #232 검증 M2)
        Promise.all([...new Set([`${cursor.year}-${cursor.month}`, ...(period ? [period.start, period.end].map((x) => `${Number(x.slice(0, 4))}-${Number(x.slice(5, 7))}`) : [])])]
          .map((k) => getWorkCalendar(Number(k.split("-")[0]), Number(k.split("-")[1])).catch(() => [] as WorkCalendarEvent[])))
          .then((ls) => [...new Map(ls.flat().map((e) => [e.id, e])).values()]),
        Promise.all(years.map((y) => getHolidays(y).catch(() => [] as Holiday[]))),
      ]);
      if (seq !== loadSeq.current) return;   // 그 사이 다른 기간을 요청했다
      const hd = hdList.flat();
      setHolidaysAll(hd);
      setShifts(s.sort((a, b) => a.date.localeCompare(b.date)));
      setRequests(r);
      setEvents(ev);
      // 이번 달 공휴일만 표시
      const mm = String(cursor.month).padStart(2, "0");
      setHolidays(hd.filter((h) => h.date.startsWith(`${cursor.year}-${mm}`)));
      // 관리자는 전체가 올 수 있어 본인 것만 표시
      setLeaves((myId ? l.filter((x) => x.userId === myId) : l).filter((x) => x.status === "APPROVED" || x.status === "PENDING"));
    } catch (error) {
      console.error("❌ Failed to load schedule:", error);
    } finally {
      if (seq === loadSeq.current) { setLoading(false); setRefreshing(false); }
    }
  }, [cursor, myId, period?.start, period?.end]);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const move = (delta: number) => {
    setLoading(true);
    if (unit === "month") {
      const m0 = cursor.month + delta;
      const nc = m0 < 1 ? { year: cursor.year - 1, month: 12 } : m0 > 12 ? { year: cursor.year + 1, month: 1 } : { year: cursor.year, month: m0 };
      setCursor(nc);
      // 달력 칸에서 고른 날도 그 달로 — 이번 달이면 오늘, 아니면 1일(#232)
      const t = ymdOf(new Date());
      setFocusDay(t.slice(0, 7) === `${nc.year}-${String(nc.month).padStart(2, "0")}` ? t : `${nc.year}-${String(nc.month).padStart(2, "0")}-01`);
      return;
    }
    // 주·일 보기: 기준 날짜를 옮기고, 달이 바뀌면 휴가·공휴일·전체 일정도 그 달로
    const next = addDays(focusDay, unit === "week" ? delta * 7 : delta);
    setFocusDay(next);
    const d = dateOf(next);
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 });
  };
  const goToday = () => {
    setLoading(true);
    const t = ymdOf(new Date());
    setFocusDay(t);
    const d = new Date();
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 });
  };
  const periodTitle = (() => {
    if (!period) return `${cursor.year}년 ${cursor.month}월`;
    if (unit === "day") { const d = dateOf(focusDay); return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`; }
    // 주 — 「10/26 (월) – 11/1 (일)」, 올해가 아니면 앞에 연도(10/23 시안 S1-3)
    const s = dateOf(period.start);
    return `${s.getFullYear() !== new Date().getFullYear() ? `${s.getFullYear()}년 ` : ""}${fmtShortD(period.start)} – ${fmtShortD(period.end)}`;
  })();
  const holidayName = (ymd: string) => holidaysAll.find((h) => String(h.date).slice(0, 10) === ymd)?.name;

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
    // 기존 일정 수정 요청은 그 하루로 고정 — 승인받은 공휴일 근무도 고칠 수 있게 공휴일 제외를 하지 않는다(#49)
    if (updateDate) return [updateDate];
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
  }, [reqStart, reqEnd, reqDays, reqHolidays, updateDate]);

  // 기간 안에서 실제로 빠진 공휴일 (사용자에게 왜 줄었는지 알려준다)
  const reqExcludedHolidays = useMemo(() => {
    if (updateDate) return [] as string[];   // 수정 요청은 그 하루를 그대로 보낸다(공휴일도 빼지 않는다)
    if (!reqStart || !reqEnd || reqStart > reqEnd) return [] as string[];
    return Object.keys(reqHolidays)
      .filter((d) => d >= reqStart && d <= reqEnd)
      .filter((d) => {
        const [y, m, dd] = d.split("-").map(Number);
        return reqDays.has(new Date(y, m - 1, dd).getDay());
      })
      .sort();
  }, [reqStart, reqEnd, reqDays, reqHolidays, updateDate]);

  const reqNetDaily = reqTemplate ? Math.max(reqTemplate.hours - breakHours(reqTemplate.hours), 0) : 0;
  const reqTotalHours = Math.round(reqDates.length * reqNetDaily * 10) / 10;
  const reqHasWeekend = reqDates.some((d) => {
    const [y, m, dd] = d.split("-").map(Number);
    const dow = new Date(y, m - 1, dd).getDay();
    return dow === 0 || dow === 6;
  });
  // 본인 신청 취소 — 잘못 낸 신청을 반려로 처리하면 기록에 "반려당함"으로 남아
  // 나중에 오해를 산다. 권한.상태는 서버가 다시 확인한다.
  const cancelMyRequest = (id: string) => {
    Alert.alert(
      "신청 취소",
      `이 신청을 취소할까요?\n\n취소하면 결재가 중단되고 기록에는 '취소'로 남습니다.`,
      [
        { text: "닫기", style: "cancel" },
        {
          text: "취소하기",
          style: "destructive",
          onPress: async () => {
            setCancelingId(id);
            try {
              await cancelMyScheduleRequest(id);
              await load();   // 목록 전체를 다시 읽는다(별도 로더가 없다)
            } catch (e: any) {
              Alert.alert("취소 실패", e?.response?.data?.error || "처리 중 오류가 발생했습니다.");
            } finally {
              setCancelingId("");
            }
          },
        },
      ]
    );
  };


  const submitRequest = async () => {
    if (!reqTemplate || !reqStart || !reqEnd || reqDates.length === 0) {
      Alert.alert("알림", "근무 시간, 기간, 요일을 모두 선택해주세요.");
      return;
    }
    if (reqDates.length > 62) {
      Alert.alert("알림", "한 번에 최대 2개월까지 신청할 수 있습니다.");
      return;
    }
    if (reqBusyRef.current) return;
    reqBusyRef.current = true;
    setReqSubmitting(true);
    try {
      const { warnings } = await createScheduleRequest({
        kind: updateDate ? "UPDATE" : "CREATE",
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
      setUpdateDate(null);
      Alert.alert("완료", `근무 변경 요청을 보냈습니다. 승인되면 일정에 반영됩니다.${warnings.length ? `\n\n${warnings.join("\n")}` : ""}`);
      load();
    } catch (e: any) {
      Alert.alert("신청 실패", e?.response?.data?.error || "신청 중 오류가 발생했습니다.");
    } finally {
      reqBusyRef.current = false;
      setReqSubmitting(false);
    }
  };

  // 기존 근무일정 누르기 → 수정·삭제 요청(2026-10-07 #49). 오늘 이후 일정만(지난 기록은 출퇴근기록 수정 요청)
  const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const onShiftPress = (s: ScheduleEntry) => {
    const date = String(s.date).slice(0, 10);
    Alert.alert(`${fmtDayLong(String(s.date).slice(0, 10))} 근무`, `${fmtTime(s.startTime, s.endTime)}\n바꾸거나 빼려면 요청을 보내 주세요. 승인되면 반영됩니다.`, [
      { text: "닫기", style: "cancel" },
      {
        text: "수정 요청",
        onPress: () => {
          const [y, m, d] = date.split("-").map(Number);
          setUpdateDate(date);
          setReqStart(date);
          setReqEnd(date);
          setReqDays(new Set([new Date(y, m - 1, d).getDay()]));
          setReqOpen(true);
        },
      },
      {
        text: "빼기 요청",
        style: "destructive",
        onPress: async () => {
          if (delBusyRef.current) return;   // 두 번 눌러도 빼기 요청은 한 번만
          delBusyRef.current = true;
          try {
            await createScheduleRequest({
              kind: "DELETE",
              templateId: "DELETE",
              templateName: "근무일정 삭제",
              startDate: date,
              endDate: date,
              scheduleData: [{ date, startTime: s.startTime, endTime: s.endTime }],
              totalHours: 0,
            });
            Alert.alert("완료", "빼기 요청을 보냈습니다. 승인되면 일정에서 빠집니다.");
            load();
          } catch (e: any) {
            Alert.alert("요청 실패", e?.response?.data?.error || "요청 중 오류가 발생했습니다.");
          } finally {
            delBusyRef.current = false;
          }
        },
      },
    ]);
  };

  // 캘린더 일정 기간 표시 (같은 날이면 한 번만)
  const fmtEventRange = (ev: WorkCalendarEvent) => {
    const s = new Date(ev.startDate);
    const e = new Date(ev.endDate);
    const f = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;
    const range = f(s) === f(e) ? f(s) : `${f(s)} ~ ${f(e)}`;
    // 시각이 있으면 붙인다(#221) — 「10/21 10:00~11:30」
    const time = ev.startTime ? (ev.endTime ? `${ev.startTime}~${ev.endTime}` : ev.startTime) : "";
    return time ? `${range} ${time}` : range;
  };

  // 날짜 줄 — 주 = 월~일 7줄, 일 = 그날, 월 = 달력 칸에서 고른 날 하나(#232 — 달 전체는 위 달력 칸으로 본다)
  const monthKey = `${cursor.year}-${String(cursor.month).padStart(2, "0")}`;
  const listDays: string[] = (() => {
    if (unit === "week" && period) return weekDays(period.start);
    if (unit === "day") return [focusDay];
    return focusDay.slice(0, 7) === monthKey ? [focusDay] : [];
  })();
  const rangeStart = listDays[0] ?? `${cursor.year}-${String(cursor.month).padStart(2, "0")}-01`;
  const rangeEnd = unit === "month" ? `${cursor.year}-${String(cursor.month).padStart(2, "0")}-31` : listDays[listDays.length - 1] ?? rangeStart;
  // 내 지점에 공유한 사본(제목 · 시작일 · 시각이 같은 지점 일정)이 있으면 원본(원장 전용 · 전사)은 빼고 사본 하나만(#230, 웹 캘린더 전체 보기와 같은 기준)
  const isCopyOf = (x: WorkCalendarEvent, e: WorkCalendarEvent) => x.id !== e.id && !!x.branch && x.branch === myBranch && !x.managersOnly && x.title === e.title
    && String(x.startDate).slice(0, 10) === String(e.startDate).slice(0, 10) && String(x.endDate).slice(0, 10) === String(e.endDate).slice(0, 10)
    && (x.startTime || null) === (e.startTime || null) && (x.endTime || null) === (e.endTime || null);
  const shownEvents = evFilter === "company" ? events.filter((e) => !e.branch && !e.managersOnly)
    : evFilter === "branch" ? events.filter((e) => !!e.branch)
    : evFilter === "managers" ? events.filter((e) => e.managersOnly)
    : events.filter((e) => !(e.managersOnly || !e.branch) || !events.some((x) => isCopyOf(x, e)));
  const eventsOnDay = (d: string) => shownEvents.filter((ev) => String(ev.startDate).slice(0, 10) <= d && d <= String(ev.endDate).slice(0, 10));
  const listEvents = (unit === "month" ? (listDays[0] ? eventsOnDay(listDays[0]) : []) : shownEvents.filter((ev) => String(ev.startDate).slice(0, 10) <= rangeEnd && String(ev.endDate).slice(0, 10) >= rangeStart))
    .slice().sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
  const fmtRangeLong = (a: string, b: string) => (a.slice(0, 10) === b.slice(0, 10) ? fmtDayLong(a.slice(0, 10)) : `${fmtDayLong(a.slice(0, 10))} ~ ${fmtDayLong(b.slice(0, 10))}`);

  // 월 달력 칸에 넣을 줄(#232) — 공휴일 · 휴가 · 내 근무 · 지점 일정 순. 색은 아래 날짜 줄 꼬리표와 같게, 지점 일정은 웹 캘린더 색
  const EVENT_COLOR: Record<string, string> = { indigo: "#6366f1", blue: "#3b82f6", green: "#22c55e", red: "#ef4444", amber: "#f59e0b" };
  const chipsOf = (d: string): DayChip[] => {
    const out: DayChip[] = [];
    const hol = holidayName(d);
    if (hol) out.push({ key: "hol", label: hol, bg: C.redBg, fg: C.red });
    const lv = leaves.find((l) => String(l.startDate).slice(0, 10) <= d && d <= String(l.endDate).slice(0, 10));
    const work = shifts.find((x) => String(x.date).slice(0, 10) === d && x.type === "work");
    const lvApproved = !!lv && lv.status === "APPROVED";
    // 칸이 좁아(360dp 폰 ≈ 48dp) 띄어쓰기를 빼 「오전반차」처럼 — 승인 대기는 글자 대신 노랑 점선 테두리로(#232 검증 M1)
    const lvLabel = (LEAVE_TYPE_LABEL[lv?.type ?? ""] || "휴가").replace(/\s+/g, "");
    if (lv) out.push(lvApproved
      ? { key: "lv", label: lvLabel, bg: C.blueBg, fg: C.blueInk }
      : { key: "lv", label: lvLabel, bg: C.ambBg, fg: C.amb, striped: true });
    const fullLeave = lvApproved && !(work && isPartialLeave(lv!.type));
    if (work && !fullLeave) out.push({ key: "work", label: work.startTime || "근무", bg: C.indBg, fg: C.indInk });
    for (const ev of eventsOnDay(d)) out.push({ key: ev.id, label: ev.title, bg: EVENT_COLOR[ev.color || "indigo"] || EVENT_COLOR.indigo, fg: "#fff" });
    return out;
  };

  // 보기 탭 — 내 일정 · (원장 · 본부) 지점 일정 · 지점 공유(#234 — 직원도 자기 지점 공유를 본다)
  const viewTabs: (readonly ["mine" | "branch" | "share", string])[] = staff
    ? [["mine", "내 일정"], ["branch", role === "ADMIN" ? "전체 지점 일정" : "지점 일정"], ["share", "지점 공유"]]
    : [["mine", "내 일정"], ["share", "지점 공유"]];
  const viewBar = role !== null ? (
    <View style={styles.viewBar}>
      {viewTabs.map(([v, label]) => (
        <TouchableOpacity key={v} style={[styles.viewTab, view === v && styles.viewTabOn]} onPress={() => setView(v)} activeOpacity={0.7}>
          <Text style={[styles.viewTabText, view === v && styles.viewTabTextOn]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  ) : null;
  if (role === null && (wantBranch || view === "branch")) return <View style={styles.container} />;
  if (view === "share") return <View style={styles.container}>{viewBar}<BranchShareView /></View>;
  if (staff && view === "branch") {
    return (
      <View style={styles.container}>
        {viewBar}
        {(role === "ADMIN" || canBulk) && (
          <TouchableOpacity style={styles.bulkBtn} onPress={() => setBulkOpen(true)} accessibilityLabel="일정 넣기 — 여러 날 · 여러 명 한 번에" activeOpacity={0.8}>
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={styles.bulkBtnText}>일정 넣기</Text>
          </TouchableOpacity>
        )}
        <BranchDayView showBranch={role === "ADMIN"} reloadKey={branchReloadKey} />
        <BranchScheduleBulkScreen
          visible={bulkOpen}
          showBranch={role === "ADMIN"}
          onClose={(didInsert) => { setBulkOpen(false); if (didInsert) setBranchReloadKey((k) => k + 1); }}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
    <ScrollView
      style={{ flex: 1 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {viewBar}
      {/* 월 이동 헤더 */}
      <View style={styles.monthBar}>
        <TouchableOpacity onPress={() => move(-1)} style={styles.monthBtn}>
          <Ionicons name="chevron-back" size={22} color="#374151" />
        </TouchableOpacity>
        <TouchableOpacity onPress={goToday} style={{ flex: 1, alignItems: "center" }} activeOpacity={0.7}>
          <Text style={styles.monthText}>{periodTitle}</Text>
          {unit !== "month" && <Text style={styles.todayHint}>제목을 누르면 오늘</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={() => move(1)} style={styles.monthBtn}>
          <Ionicons name="chevron-forward" size={22} color="#374151" />
        </TouchableOpacity>
      </View>
      {/* 보기 단위(#81): 월 · 주 · 일 */}
      <View style={styles.unitBar}>
        {(["month", "week", "day"] as CalendarUnit[]).map((u) => (
          <TouchableOpacity key={u} style={[styles.unitChip, unit === u && styles.unitChipOn]} onPress={() => { if (u !== unit) { setLoading(true); setUnit(u); } }}>
            <Text style={[styles.unitChipText, unit === u && styles.unitChipTextOn]}>{UNIT_LABEL[u]}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {/* 지점 일정 종류 고르기(#234 — 웹 캘린더처럼 전사 · 지점 · 원장을 따로) */}
      <View style={styles.evFilterWrap}>
        <TouchableOpacity style={styles.evFilterBtn} onPress={() => setEvPickOpen((v) => !v)} activeOpacity={0.7}>
          <Text style={styles.evFilterLabel}>캘린더</Text>
          <Text style={styles.evFilterValue}>{EV_FILTER_LABEL[evFilter]}</Text>
          <Ionicons name={evPickOpen ? "chevron-up" : "chevron-down"} size={15} color={C.sub} />
        </TouchableOpacity>
        {evPickOpen && (
          <View style={styles.evFilterList}>
            {(staff ? (["all", "company", "branch", "managers"] as const) : (["all", "company", "branch"] as const)).map((k) => (
              <TouchableOpacity key={k} style={[styles.evFilterItem, evFilter === k && { backgroundColor: C.indBg }]} onPress={() => { setEvFilter(k); setEvPickOpen(false); }}>
                <Text style={[styles.evFilterItemText, evFilter === k && { color: C.ind, fontWeight: "700" }]}>{EV_FILTER_LABEL[k]}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
        </View>
      ) : (
        <>
          {/* 월 보기 = 달력 칸(#232) — 칸을 누르면 아래 날짜 줄 · 지점 일정이 그날 것으로 */}
          {unit === "month" && (
            <MonthGrid year={cursor.year} month={cursor.month} today={todayStr} selected={focusDay} onSelect={setFocusDay}
              chipsOf={chipsOf} isRedDay={(d) => !!holidayName(d)} />
          )}
          {/* 날짜 줄 — 날짜마다 근무 시간 · 연차 · 주말 근무(10/23 앱 6, 시안 S1-3). 주 보기는 월~일 7줄 */}
          <View style={styles.dayList}>
            {listDays.length === 0 ? (
              <Text style={[styles.empty, { paddingHorizontal: 14 }]}>{unit === "month" ? "달력에서 날짜를 누르면 그날 일정이 여기 나옵니다." : "등록된 일정이 없습니다."}</Text>
            ) : listDays.map((d, i) => {
              const my = shifts.filter((x) => String(x.date).slice(0, 10) === d);
              const work = my.find((x) => x.type === "work");
              const lv = leaves.find((l) => String(l.startDate).slice(0, 10) <= d && d <= String(l.endDate).slice(0, 10));
              const hol = holidayName(d);
              const isTodayRow = d === todayStr;
              const we = isWeekend(d);
              const editable = !!work && d >= todayStr;
              const lvApproved = !!lv && lv.status === "APPROVED";
              const fullLeave = lvApproved && !(work && isPartialLeave(lv!.type));   // 반나절 · 반반차는 유형 단위로(BranchDayView 와 같은 함수 — 코드 글자로 추측하지 않는다)
              const mid = work && !fullLeave ? fmtTime(work.startTime, work.endTime).replace("–", " – ") : lv ? "—" : hol ? hol : my.length ? (TYPE_LABEL[my[0].type]?.label ?? "쉬는 날") : "쉬는 날";
              return (
                <TouchableOpacity key={d} style={[styles.dayRow2, i > 0 && styles.dayLine, isTodayRow && styles.dayToday]} disabled={!editable} onPress={() => work && onShiftPress(work)} activeOpacity={0.6}>
                  <View style={styles.dy}>
                    <Text style={[styles.dyDow, we && { color: C.weekend }]}>{wd(d)}</Text>
                    <Text style={styles.dyNum}>{Number(d.slice(5, 7))}/{Number(d.slice(8, 10))}</Text>
                  </View>
                  <Text style={[styles.dayMid, !work && styles.dayMidOff]} numberOfLines={1}>{mid}</Text>
                  <View style={styles.dayTags}>
                    {isTodayRow && <View style={[styles.tag, { backgroundColor: C.indBg }]}><Text style={[styles.tagText, { color: C.indInk }]}>오늘</Text></View>}
                    {!!lv && (
                      lvApproved
                        ? <View style={[styles.tag, { backgroundColor: C.blueBg }]}><Text style={[styles.tagText, { color: C.blueInk }]}>{LEAVE_TYPE_LABEL[lv.type] || "휴가"}</Text></View>
                        : <View style={[styles.tag, { backgroundColor: C.ambBg }]}><Text style={[styles.tagText, { color: C.amb }]}>{LEAVE_TYPE_LABEL[lv.type] || "휴가"} 승인 대기</Text></View>
                    )}
                    {!!work && we && !fullLeave && <View style={[styles.tag, { backgroundColor: C.vioBg }]}><Text style={[styles.tagText, { color: C.vio }]}>주말 근무</Text></View>}
                    {!!hol && !!work && <View style={[styles.tag, { backgroundColor: C.grayBg }]}><Text style={[styles.tagText, { color: C.gray }]}>{hol}</Text></View>}
                  </View>
                  {editable && <Ionicons name="chevron-forward" size={16} color="#cbd5e1" />}
                </TouchableOpacity>
              );
            })}
          </View>
          {listDays.some((d) => d >= todayStr && shifts.some((x) => x.type === "work" && String(x.date).slice(0, 10) === d)) && (
            <Text style={styles.hint}>근무 줄을 누르면 시간 변경 · 빼기를 요청할 수 있습니다.</Text>
          )}

          {/* 근무 변경 요청 — 승인 대기 중인 것만(지난 요청은 더보기 › 내 요청) */}
          {requests.filter((r) => r.status === "PENDING").length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>근무 변경 요청</Text>
              {requests.filter((r) => r.status === "PENDING").map((r) => {
                const st = REQ_STATUS[r.status] || REQ_STATUS.PENDING;
                return (
                  <View key={r.id} style={styles.reqItem}>
                    <View style={styles.reqHeader}>
                      <Text style={styles.reqTitle} numberOfLines={1}>{stripTimes(r.templateName) || "근무 변경"}</Text>
                      <View style={[styles.badge, { backgroundColor: st.bg }]}>
                        <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.reqMeta}>{fmtRangeLong(String(r.startDate), String(r.endDate))}</Text>
                    {/* 서버 판정(canCancel) — 대기 중 + 지난 신청 아님(9/11 검증 D1). 반려와 다르다: 취소는 신청 자체를 거둔다 */}
                    {(r as { canCancel?: boolean }).canCancel && (
                      <TouchableOpacity style={styles.reqCancelBtn} disabled={cancelingId === r.id} onPress={() => cancelMyRequest(r.id)}>
                        {cancelingId === r.id ? <ActivityIndicator size="small" color="#64748b" /> : <Text style={styles.reqCancelBtnText}>요청 취소</Text>}
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* 지점 일정 — 한 줄 묶음(회사 · 지점 공통 일정, 큐브티워크 캘린더) */}
          {listEvents.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>지점 일정</Text>
              <View style={styles.dayList}>
                {listEvents.map((ev, i) => {
                  const sd = String(ev.startDate).slice(0, 10);
                  return (
                    <View key={ev.id} style={[styles.dayRow2, i > 0 && styles.dayLine]}>
                      <View style={styles.dy}>
                        <Text style={styles.dyDow}>{Number(sd.slice(5, 7))}/{Number(sd.slice(8, 10))}</Text>
                        <Text style={[styles.dyNum, isWeekend(sd) && { color: C.weekend }]}>{wd(sd)}</Text>
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.eventTitle} numberOfLines={1}>{ev.title}</Text>
                        <Text style={styles.eventSub} numberOfLines={1}>{[fmtEventRange(ev), ev.managersOnly ? "원장 전용" : ev.branch || "전사"].filter(Boolean).join(" · ")}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          )}
        </>
      )}

      {/* 근무일정 신청 모달 */}
      <Modal visible={reqOpen} transparent animationType="slide" onRequestClose={closeReq}>
        <KeyboardAvoidingView style={styles.reqBg} behavior="padding">
          <View style={[styles.reqCard, { maxHeight: "90%" }]}>
            <Text style={styles.reqTitle2}>{updateDate ? `근무 시간 변경 요청 · ${fmtDayLong(updateDate)}` : "근무 변경 요청"}</Text>
            {/* 키보드가 뜨면 남은 높이 안에서 줄어든다(카드 위쪽이 화면 밖으로 잘리지 않게, #233 검증 2) */}
            <ScrollView style={{ maxHeight: 480, flexShrink: 1 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.reqLabel}>근무 시간</Text>
              <View style={styles.tmplWrap}>
                {templates.map((t) => (
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
                  <Text style={[styles.tmplChipText, customOn && styles.tmplChipTextOn]}>직접 입력</Text>
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

              {!updateDate && (<>
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
                    <Text style={[styles.dayChipText, (i === 0 || i === 6) && { color: C.weekend }, reqDays.has(i) && styles.dayChipTextOn]}>{d}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              </>)}

              {reqDates.length > 0 && reqTemplate && (
                <View style={styles.reqSummary}>
                  <Text style={styles.reqSummaryText}>
                    근무일 {reqDates.length}일 · 총 {reqTotalHours}시간 (일 {reqNetDaily}시간, 휴게 제외)
                  </Text>
                  {reqExcludedHolidays.length > 0 && (
                    <Text style={styles.reqHolidayNote}>
                      공휴일 {reqExcludedHolidays.length}일 빠짐 ({reqExcludedHolidays.map((d) => reqHolidays[d]).join(", ")})
                    </Text>
                  )}
                  {reqHolidayState === "error" && (
                    <Text style={styles.reqWeekendNote}>
                      공휴일 정보를 불러오지 못했습니다. 연휴가 근무일로 포함될 수 있으니 날짜를 확인해주세요.
                    </Text>
                  )}
                  {reqHasWeekend && (
                    <Text style={styles.reqWeekendNote}>주말 근무 포함 — 승인되면 주말 출근을 찍을 수 있습니다.</Text>
                  )}
                </View>
              )}
            </ScrollView>

            <View style={styles.reqBtns}>
              <TouchableOpacity style={styles.reqCancel} onPress={closeReq}>
                <Text style={styles.reqCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.reqSubmit, (!reqTemplate || reqDates.length === 0) && { opacity: 0.5 }]}
                disabled={!reqTemplate || reqDates.length === 0 || reqSubmitting}
                onPress={submitRequest}
              >
                {reqSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.reqSubmitText}>요청 보내기</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </ScrollView>
    {/* 아래 고정 띠 — 근무 변경 요청(「일정 신청」에서 이름을 바꿨다, 10/23 앱 6) */}
    <View style={styles.dock}>
      <TouchableOpacity style={styles.dockBtn} onPress={() => setReqOpen(true)} accessibilityLabel="근무 변경 요청">
        <Text style={styles.dockBtnText}>근무 변경 요청</Text>
      </TouchableOpacity>
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  // 날짜 줄(10/23 앱 6)
  dayList: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: "hidden", marginHorizontal: 14, marginTop: 12 },
  dayRow2: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56 },
  dayLine: { borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  dayToday: { backgroundColor: "#f7f8ff" },
  dy: { width: 44 },
  dyDow: { fontSize: 14, fontWeight: "700", color: "#334155" },
  dyNum: { fontSize: 12.5, color: C.muted, marginTop: 1 },
  dayMid: { flex: 1, fontSize: 15, fontWeight: "700", color: C.ink },
  dayMidOff: { fontWeight: "500", color: C.muted },
  dayTags: { flexDirection: "row", gap: 4, flexShrink: 0 },
  tag: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  tagText: { fontSize: 12.5, fontWeight: "700" },
  eventSub: { fontSize: 13, color: C.sub, marginTop: 2 },
  dock: { backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  dockBtn: { height: 46, borderRadius: 14, borderWidth: 1.5, borderColor: C.indBd, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  dockBtnText: { fontSize: 15, fontWeight: "800", color: C.ind },
  viewBar: { flexDirection: "row", margin: 12, marginBottom: 0, backgroundColor: "#e5e7eb", borderRadius: 10, padding: 3 },
  // 지점 일정 「일정 넣기」 — 실행 = 인디고(■4), 누르는 자리 44px
  bulkBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 44, marginHorizontal: 12, marginTop: 10, marginBottom: 8, borderRadius: 12, backgroundColor: C.ind },
  bulkBtnText: { color: "#fff", fontSize: 15, fontWeight: "800" },
  viewTab: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, borderRadius: 8 },
  viewTabOn: { backgroundColor: "#fff" },
  viewTabText: { fontSize: 14, color: "#6b7280", fontWeight: "500" },
  viewTabTextOn: { color: "#4f46e5", fontWeight: "700" },
  center: { padding: 40, alignItems: "center" },
  monthBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  monthBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  monthText: { fontSize: 17, fontWeight: "bold", color: "#111827" },
  todayHint: { fontSize: 12, color: C.muted, marginTop: 2 },
  // 보기 단위(#81)
  evFilterWrap: { backgroundColor: "#fff", paddingHorizontal: 14, paddingBottom: 10, alignItems: "flex-end" },
  evFilterBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: "#e5e7eb", backgroundColor: "#f9fafb" },
  evFilterLabel: { fontSize: 13, color: C.muted },
  evFilterValue: { fontSize: 14, fontWeight: "700", color: C.ink },
  evFilterList: { marginTop: 4, minWidth: 140, backgroundColor: "#fff", borderWidth: 1, borderColor: C.line, borderRadius: 10, overflow: "hidden" },
  evFilterItem: { minHeight: 44, justifyContent: "center", paddingHorizontal: 14 },
  evFilterItemText: { fontSize: 15, color: C.ink },
  unitBar: { flexDirection: "row", justifyContent: "center", gap: 6, backgroundColor: "#fff", paddingBottom: 10 },
  unitChip: { minWidth: 56, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, borderRadius: 999, borderWidth: 1, borderColor: "#e5e7eb", backgroundColor: "#f9fafb" },
  unitChipOn: { backgroundColor: "#111827", borderColor: "#111827" },
  unitChipText: { fontSize: 13, color: "#374151", fontWeight: "600" },
  unitChipTextOn: { color: "#fff" },
  weekStrip: { flexDirection: "row", gap: 4, paddingHorizontal: 12, paddingTop: 12 },
  weekDay: { flex: 1, backgroundColor: "#fff", borderRadius: 10, paddingVertical: 8, alignItems: "center", borderWidth: 1, borderColor: "#e5e7eb" },
  weekDayToday: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  weekDow: { fontSize: 11, color: "#6b7280" },
  weekNum: { fontSize: 16, fontWeight: "700", color: "#111827", marginVertical: 2 },
  weekNumToday: { color: "#2563eb" },
  weekShift: { fontSize: 10, color: "#374151", textAlign: "center", lineHeight: 13 },
  section: { padding: 16, paddingTop: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#111827", marginBottom: 10 },
  empty: { color: "#9ca3af", fontSize: 14, paddingVertical: 12 },
  hint: { color: C.muted, fontSize: 13, marginTop: 8, marginHorizontal: 16, lineHeight: 18 },
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
  tmplChipOn: { borderColor: C.ind, backgroundColor: C.indBg },
  tmplChipText: { fontSize: 13, color: "#374151" },
  tmplChipTextOn: { color: C.ind, fontWeight: "700" },
  // 시간 직접 설정 박스
  customBox: { borderWidth: 1, borderColor: C.indBd, borderRadius: 10, padding: 12, marginTop: 8, gap: 8, backgroundColor: C.indBg },
  customRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  customLabel: { fontSize: 13, color: "#6b7280", width: 30 },
  customValue: { fontSize: 17, fontWeight: "700", color: "#111827", width: 60, textAlign: "center" },
  stepBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center" },
  stepBtnText: { fontSize: 18, color: "#374151", lineHeight: 22 },
  customHours: { fontSize: 13, fontWeight: "600", color: C.ind },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateTilde: { fontSize: 15, color: "#9ca3af" },
  dayRow: { flexDirection: "row", gap: 6 },
  dayChip: { flex: 1, height: 38, borderRadius: 8, borderWidth: 1, borderColor: "#e5e7eb", alignItems: "center", justifyContent: "center", backgroundColor: "#f9fafb" },
  dayChipOn: { borderColor: C.ind, backgroundColor: C.ind },
  dayChipText: { fontSize: 14, color: "#374151", fontWeight: "600" },
  dayChipTextOn: { color: "#fff" },
  reqSummary: { marginTop: 14, backgroundColor: C.indBg, borderRadius: 10, padding: 12 },
  reqSummaryText: { fontSize: 13.5, color: C.indInk, fontWeight: "700" },
  reqWeekendNote: { fontSize: 12, color: "#b45309", marginTop: 4 },
  reqHolidayNote: { fontSize: 12.5, color: C.sub, marginTop: 4 },
  reqBtns: { flexDirection: "row", gap: 8, marginTop: 14 },
  reqCancel: { flex: 1, height: 48, borderRadius: 10, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  reqCancelBtn: { alignSelf: "flex-start", marginTop: 8, minHeight: 40, justifyContent: "center", paddingHorizontal: 12,
                  borderRadius: 6, borderWidth: 1, borderColor: "#d1d5db", backgroundColor: "#fff" },
  reqCancelBtnText: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  reqCancelText: { fontSize: 15, color: "#374151", fontWeight: "600" },
  reqSubmit: { flex: 1, height: 48, borderRadius: 12, backgroundColor: C.ind, alignItems: "center", justifyContent: "center" },
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
