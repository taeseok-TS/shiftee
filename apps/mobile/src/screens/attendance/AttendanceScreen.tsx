import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";
import * as attendance from "../../services/attendance";
import * as storage from "../../services/storage";
import * as api from "../../services/api";
import { getMySchedulesRange, type MyShift } from "../../services/schedule";
import { LEAVE_LABELS } from "../../services/leaveLabels";
import { C, addDaysYmd, fmtDay, fmtShort, fmtTime, isWeekend, todayYmd, wd, weekOfYmd, ymd } from "../../services/fmt";
import AttendanceRequestModal, { RequestDraft } from "../../components/AttendanceRequestModal";

// 출퇴근(2026-10-23 본부 요청 앱 4 · ■0-7 · ■0-11, 시안 S1-1)
//  · 맨 위 「오늘 내 근무 13:00 – 22:00」 + 지점 이름(좌표 숫자 대신), 상태 점은 출근 전 = 회색
//  · 큰 버튼 하나를 화면 아래 고정 띠에 — 출근 전 「출근하기」, 출근 뒤 「퇴근하기」(인디고)
//  · 찍은 시각 · 일한 시간은 보이지 않는다(본부만). 지난 기록은 날짜별 상태 알약만, 퇴근 누락이면 그 줄에서 「수정 요청」
//    시각 표시는 서버 timesHidden 으로 가른다(본부 · 「출퇴근 시각 보기」 켠 원장은 본인 출근 시각도 보인다 — 검증 B4)
//  · 기록이 필요하면 「출퇴근 기록 요청 · 본부에 요청 ›」(RECORD — 기간 · 쓰는 곳, 본부가 내준다. 본부 계정은 직접 보므로 없음)
//  · 10/25 이전(시프티 기록) · 시프티에서 옮긴 기록에는 「수정 요청」을 그리지 않는다 — 서버가 받지 않는다(검증 B2)
type Phase = "LOADING" | "OUT" | "IN" | "DONE";
type FailReason = "permission" | "services" | "timeout" | "outside" | "nolocation";

// 실패 이유별 안내(2026-10-07 #13) — 반경 밖 · 위치 권한 꺼짐 · 휴대폰 위치 꺼짐 · 위치 확인 지연
const FAIL_TEXT: Record<FailReason, string> = {
  permission: "위치 권한이 꺼져 있어요. 설정에서 큐브티 위치 권한을 「앱 사용 중 허용」으로 바꿔 주세요.",
  services: "휴대폰 위치(GPS)가 꺼져 있어요. 휴대폰 설정에서 위치 서비스를 켜 주세요.",
  timeout: "위치 확인이 늦어지고 있어요. 창가나 건물 입구 쪽에서 다시 눌러 주세요.",
  outside: "지점 밖이에요.",
  nolocation: "위치 정보가 오지 않았어요. 위치 권한과 GPS 를 확인해 주세요.",
};

const STATUS_LABEL: Record<string, string> = { PENDING: "승인 대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소함" };
// 큐브티로 출퇴근을 찍기 시작한 날(2026-10-26 지점 전환) — 그 전 날짜는 시프티 원본이라 이 앱에서 고치지 않는다(서버 attendance-requests 와 같은 날짜)
const CUBETEE_ATTENDANCE_START = "2026-10-26";
const hhmm = (iso?: string | null) => { if (!iso) return ""; const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const STATUS_COLOR: Record<string, string> = { PENDING: C.amb, APPROVED: C.blue, REJECTED: C.red, CANCELLED: "#94a3b8" };
type PillTone = "gray" | "red" | "blue";
const PILL: Record<PillTone, { fg: string; bg: string }> = { gray: { fg: C.gray, bg: C.grayBg }, red: { fg: C.red, bg: C.redBg }, blue: { fg: C.blueInk, bg: C.blueBg } };
type PastRow = { date: string; pills: { text: string; tone: PillTone }[]; fix?: RequestDraft };

export default function AttendanceScreen() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [phase, setPhase] = useState<Phase>("LOADING");
  const [pending, setPending] = useState<{ in: boolean; out: boolean }>({ in: false, out: false });
  const [isLoading, setIsLoading] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number; accuracy?: number | null } | null>(null);   // 요청에 실어 보낼 위치(화면에는 숫자를 보이지 않는다)
  const [relocating, setRelocating] = useState(false);   // 「위치를 다시 잡는 중」(2026-10-27 — 첫 판정이 지점 밖이면 정밀 측위로 한 번 더 재서 판정)
  // 같은 출근(또는 퇴근)에서 연속 실패 횟수 — 3번이면 사진·본부 요청을 안내한다(본부 답변 #11)
  const [fail, setFail] = useState<{ count: number; reason: FailReason; detail?: string; pressedAt: string } | null>(null);
  const [missed, setMissed] = useState<attendance.MissedOut | null>(null);
  const [consenting, setConsenting] = useState(false);
  const [branch, setBranch] = useState("");
  const [insideNow, setInsideNow] = useState(false);   // 이번에 위치 인증을 통과해 찍었다(= 지점 안)
  const [week, setWeek] = useState<MyShift[]>([]);
  const [myLeaves, setMyLeaves] = useState<{ start: string; end: string; type: string; status: string }[]>([]);
  const [past, setPast] = useState<attendance.MyDayRecord[] | null>(null);   // null = 열람 권한 없음(또는 아직)
  const [role, setRole] = useState("");
  // 오늘 찍은 시각 — 서버가 시각을 줄 때만(본부 · 「출퇴근 시각 보기」 켠 원장). 직원 · 원장(끔)은 null
  const [times, setTimes] = useState<{ in: string; out: string } | null>(null);
  const md = (d: string) => fmtShort(d);
  // 전날 퇴근 누락 → 근무일정 퇴근 시각으로 처리 동의(#215-4, 2026-10-17 #219-4 — 종전 22:00 고정).
  // 시각은 서버가 정한다(관리자 자동 마감과 같은 기준). 동의 시각·사람·기준이 기록되고, 실제와 다르면 「퇴근 처리 요청」으로 고친다
  const consentOut = (m: attendance.MissedOut) => {
    if (!m.closeAt || !m.closeHhmm) return;
    const t = m.closeHhmm;
    Alert.alert(
      `${md(m.date)} 퇴근 기록이 없습니다`,
      `${t} 퇴근(${m.closeLabel || "근무일정 기준"})으로 처리하는 데 동의합니다.\n(동의한 시각과 이름이 기록됩니다. 실제 퇴근이 ${t}가 아니면 「퇴근 처리 요청하기」로 시각을 넣어 주세요.)`,
      [
        { text: "취소", style: "cancel" },
        { text: `동의하고 ${t} 퇴근 처리`, onPress: async () => {
          setConsenting(true);
          try {
            await attendance.consentMissedOut(m.date, m.closeAt!);
            Alert.alert("처리됨", `${md(m.date)} 퇴근을 근무일정 퇴근 시각으로 처리했습니다.`);
            loadExtras();
          } catch (e: unknown) {
            const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
            Alert.alert("처리 못 함", msg);
            loadExtras();   // 처리될 시각이 바뀌었으면(409) 새 시각으로 다시 보여 준다
          } finally { setConsenting(false); }
        } },
      ],
    );
  };
  const [requests, setRequests] = useState<attendance.AttendanceRequestRow[]>([]);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 15000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { storage.getUser().then((u) => { setBranch(u?.branch || ""); setRole(u?.role || ""); }).catch(() => {}); }, []);

  const loadStatus = async () => {
    try {
      const s = await attendance.getTodayStatus();
      // 출근 요청이 승인 대기 중이면 퇴근은 찍을 수 있다(본부 답변 #10)
      setPhase(s.clockedOut || s.pendingOut || s.pendingInClockedOut ? "DONE" : s.clockedIn || s.pendingIn ? "IN" : "OUT");
      setPending({ in: !!s.pendingIn && !s.clockedIn, out: !!s.pendingOut });
      // 시각을 보여도 되는지는 서버 timesHidden(옛 서버면 시각이 왔는지로) — 역할로 가리지 않는다
      const show = typeof s.timesHidden === "boolean" ? !s.timesHidden : !!s.clockInAt;
      setTimes(show && s.clockInAt ? { in: hhmm(s.clockInAt), out: hhmm(s.clockOutAt) } : null);
    } catch {
      setPhase("OUT"); // 조회 실패 시 기본 출근 가능 상태
    }
  };
  const loadExtras = async () => {
    attendance.getMissedOut().then(setMissed).catch(() => {});
    attendance.getMyAttendanceRequests().then((r) => setRequests(r.slice(0, 10))).catch(() => {});
    // 이번 주 일정 + 지난 7일(지난 기록 줄) — 근무일정 · 휴가
    const today = todayYmd();
    const wk = weekOfYmd(today);
    const from = addDaysYmd(today, -7) < wk.start ? addDaysYmd(today, -7) : wk.start;
    getMySchedulesRange(from, wk.end).then(setWeek).catch(() => {});
    api.getLeaveRequests().then((l) => setMyLeaves(l.filter((x) => x.status === "APPROVED" || x.status === "PENDING").map((x) => ({ start: ymd(x.startDate), end: ymd(x.endDate), type: x.type, status: x.status })))).catch(() => {});
    // 지난 기록 — 이번 달(월초면 지난달도). 권한이 꺼져 있으면 null(퇴근 누락 안내만)
    const d = new Date(), months: [number, number][] = [[d.getFullYear(), d.getMonth() + 1]];
    if (d.getDate() <= 7) { const p = new Date(d.getFullYear(), d.getMonth() - 1, 1); months.push([p.getFullYear(), p.getMonth() + 1]); }
    // 본인 줄만(원장은 지점 사람 기록이 함께 올 수 있다 — 검증 B6)
    storage.getUser().catch(() => null)
      .then((u) => Promise.all(months.map(([y, m]) => attendance.getMyAttendanceMonth(y, m, u?.id || undefined))))
      .then((list) => setPast(list.some((x) => x === null) ? null : list.flat().filter((x): x is attendance.MyDayRecord => !!x)))
      .catch(() => setPast(null));
  };

  // 화면에 들어올 때마다 오늘 출퇴근 상태를 다시 불러온다(위치는 누르는 순간 새로 잰다)
  useFocusEffect(
    useCallback(() => {
      loadStatus();
      loadExtras();
      refreshShownLocation();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadStatus(), loadExtras()]);
    setRefreshing(false);
  };

  // 출근→퇴근으로 바뀌면 실패 횟수는 새로 센다
  const lastPhase = useRef<Phase>("LOADING");
  useEffect(() => {
    if (lastPhase.current !== phase) setFail(null);
    lastPhase.current = phase;
  }, [phase]);

  // 위치를 **누르는 순간마다 새로** 잰다(2026-10-06). 종전에는 화면을 처음 열 때 한 번만 재서,
  // 지점 밖에서 앱을 열었다가 걸어 들어와 누르면 옛 위치로 계속 「반경 밖」이 됐다(하단 탭 화면은 계속 살아 있다).
  type Fix = { ok: true; latitude: number; longitude: number; accuracy: number | null } | { ok: false; reason: "permission" | "services" | "timeout" };
  // precise = 정밀 측위(지점 밖 판정 뒤 다시 잡을 때) — 시간을 더 주고(최대 8초) 마지막 저장 위치는 쓰지 않는다
  const measure = async (precise = false): Promise<Fix> => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== "granted") perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return { ok: false, reason: "permission" };
      if (!(await Location.hasServicesEnabledAsync())) return { ok: false, reason: "services" };
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: precise ? Location.Accuracy.Highest : Location.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), precise ? 8000 : 12000)),
      ]);
      if (fresh) return { ok: true, latitude: fresh.coords.latitude, longitude: fresh.coords.longitude, accuracy: fresh.coords.accuracy ?? null };
      if (precise) return { ok: false, reason: "timeout" };
      // 새 위치가 늦으면 1분 안에 잰 위치까지는 쓴다(실내에서 GPS 가 늦게 잡히는 경우)
      const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
      if (last) return { ok: true, latitude: last.coords.latitude, longitude: last.coords.longitude, accuracy: last.coords.accuracy ?? null };
      return { ok: false, reason: "timeout" };
    } catch {
      return { ok: false, reason: "timeout" };
    }
  };

  const refreshShownLocation = async () => {
    const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
    if (perm?.status !== "granted") return; // 화면 들어올 때는 권한 창을 띄우지 않는다
    const f = await measure();
    if (f.ok) setLocation({ latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy });
  };

  const recordFail = (reason: FailReason, pressedAt: string, detail?: string) =>
    setFail((p) => ({ count: (p?.count ?? 0) + 1, reason, detail, pressedAt }));

  const busy = useRef(false);   // 빠른 두 번 탭 방지(검증관 P4) — state 는 다음 렌더 전까지 바뀌지 않는다
  const handlePress = async () => {
    if (phase === "DONE" || phase === "LOADING" || busy.current) return;
    busy.current = true;
    setIsLoading(true);
    const pressedAt = new Date().toISOString();   // 요청으로 넘어가면 이 시각으로 기록된다(본부 답변 #10)
    try {
      let f = await measure();
      if (!f.ok) {
        recordFail(f.reason, pressedAt);
        if (f.reason === "permission") {
          Alert.alert("위치 권한이 꺼져 있어요", FAIL_TEXT.permission, [
            { text: "닫기", style: "cancel" },
            { text: "설정 열기", onPress: () => Linking.openSettings().catch(() => {}) },
          ]);
        }
        return;
      }
      setLocation({ latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy });
      // 서버 판정 — 지점 밖(403)이면 바로 실패로 두지 않고 「위치를 다시 잡는 중」으로 정밀 측위 한 번 더(2026-10-27 이예지:
      //  건물 안에서는 첫 위치가 수백 m 튀어 지점 안인데 지점 밖으로 떴다). 두 번째도 밖이면 그때 실패 카드
      const send = async (fix: typeof f & { ok: true }) =>
        phase === "IN" ? attendance.clockOut(fix.latitude, fix.longitude, fix.accuracy) : attendance.clockIn(fix.latitude, fix.longitude, fix.accuracy);
      let r: any;
      try {
        r = await send(f);
      } catch (first: any) {
        if (!first?.response?.data?.outsideGeofence) throw first;
        setRelocating(true);
        try {
          const again = await measure(true);
          if (!again.ok) throw first;   // 정밀 측위가 안 되면 첫 판정 그대로
          f = again;
          setLocation({ latitude: f.latitude, longitude: f.longitude, accuracy: f.accuracy });
          r = await send(f);
        } finally {
          setRelocating(false);
        }
      }
      if (phase === "IN") {
        // 출근 요청 승인 대기 중이면 퇴근은 요청에 담겨, 승인될 때 함께 기록된다
        setInsideNow(true);
        Alert.alert("퇴근했어요", r?.pendingIn ? r.message || "퇴근을 남겼습니다. 출근 요청이 승인되면 함께 기록됩니다." : "퇴근이 기록되었습니다.");
        setPhase("DONE");
      } else {
        setInsideNow(true);
        Alert.alert("출근했어요", "출근이 기록되었습니다.");
        setPhase("IN");
      }
      setFail(null);
    } catch (error: any) {
      const d = error?.response?.data;
      if (d?.outsideGeofence) {
        // 거리 · 오차를 그대로 보여 준다 — 오차가 크면 폰 설정(정확한 위치) 안내가 붙는다(아래 실패 카드)
        const acc = d?.accuracy ?? location?.accuracy ?? null;
        recordFail("outside", pressedAt, d?.distance != null
          ? `지점에서 약 ${d.distance}m 떨어져 있어요(인정 거리 ${d.radius}m)${acc != null ? ` · 위치 오차 약 ${Math.round(acc)}m` : ""}.`
          : undefined);
        setInsideNow(false);
      } else if (d?.needsLocation) {
        recordFail("nolocation", pressedAt);
      } else {
        // 서버 메시지(주말 사전승인·기기 등)를 그대로 노출
        Alert.alert("처리 불가", d?.error || "출퇴근 기록 중 오류가 발생했습니다");
      }
      loadStatus(); // 상태 동기화
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  const action: "IN" | "OUT" = phase === "IN" ? "OUT" : "IN";
  const word = action === "IN" ? "출근" : "퇴근";
  const openClockRequest = (kind: "OUTSIDE" | "PHOTO" | "HQ") =>
    setDraft({ kind, action, pressedAt: fail?.pressedAt ?? new Date().toISOString(), location });

  const onRequestDone = (message: string) => {
    setDraft(null);
    setFail(null);
    Alert.alert("요청 완료", message);
    loadStatus();
    loadExtras();
  };

  const cancelRequest = (r: attendance.AttendanceRequestRow) => {
    const extra = r.action === "IN" ? "\n\n출근 요청을 거두면 그 뒤에 남긴 퇴근(퇴근 요청 포함)도 함께 사라집니다." : "";
    Alert.alert("요청 취소", `이 요청을 거둘까요?\n${r.summary}${extra}`, [
      { text: "아니요", style: "cancel" },
      {
        text: "취소하기", style: "destructive",
        onPress: async () => {
          try {
            await attendance.cancelAttendanceRequest(r.id);
            loadStatus();
            loadExtras();
          } catch (e: any) {
            Alert.alert("취소하지 못했어요", e?.response?.data?.error || "잠시 후 다시 시도해 주세요.");
          }
        },
      },
    ]);
  };

  // ── 오늘 · 이번 주 ──
  const today = todayYmd();
  const wk = weekOfYmd(today);
  const shiftOf = (d: string) => week.find((s) => ymd(s.date) === d && s.type === "work");
  const leaveOf = (d: string) => myLeaves.find((l) => l.start <= d && d <= l.end);
  const todayShift = shiftOf(today);
  const todayLeave = leaveOf(today);
  const nowHHmm = `${String(currentTime.getHours()).padStart(2, "0")}:${String(currentTime.getMinutes()).padStart(2, "0")}`;
  const minOf = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const untilText = (t: string) => {
    const diff = minOf(t) - (currentTime.getHours() * 60 + currentTime.getMinutes());
    if (diff <= 0) return "";
    return diff >= 60 ? `${Math.floor(diff / 60)}시간${diff % 60 ? ` ${diff % 60}분` : ""}` : `${diff}분`;
  };
  const dockLine = phase === "DONE"
    ? "오늘 근무를 마쳤어요"
    : phase === "IN"
    ? (todayShift ? `${todayShift.endTime} 퇴근 예정 · 지금 ${nowHHmm}` : `지금 ${nowHHmm}`)
    : todayShift && untilText(todayShift.startTime)
    ? `${todayShift.startTime} 출근까지 ${untilText(todayShift.startTime)} · 지금 ${nowHHmm}`
    : todayShift ? `${todayShift.startTime} 출근 · 지금 ${nowHHmm}` : `지금 ${nowHHmm}`;

  const statusUi =
    phase === "IN"
      ? { dot: pending.in ? C.amb : C.ind, text: pending.in ? "근무 중 · 출근 요청 승인 대기" : times?.in ? `근무 중 · ${times.in} 출근` : "근무 중" }
      : phase === "DONE"
      ? { dot: pending.out || pending.in ? C.amb : "#94a3b8", text: pending.out ? "퇴근 요청 승인 대기" : pending.in ? "퇴근 · 출근 요청 승인 대기" : times?.in ? `퇴근 · ${fmtTime(times.in, times.out || null)}` : "퇴근" }
      : { dot: "#94a3b8", text: phase === "LOADING" ? "확인 중…" : "출근 전" };
  // 지점 칩 — 좌표 숫자 대신 지점 이름. 「지점 안」은 위치 인증을 통과해 출근한 뒤에만(서버가 지점 안인지 미리 알려 주지 않는다)
  const placeText = branch ? (pending.in ? `${branch} · 지점 밖 요청` : insideNow ? `${branch} · 지점 안` : branch) : "";

  const buttonLabel = phase === "IN" ? "퇴근하기" : phase === "DONE" ? "오늘 근무 끝" : "출근하기";
  const buttonDisabled = isLoading || phase === "DONE" || phase === "LOADING";

  // 지난 기록 — 날짜별 상태 알약만(시각 없음). 열람 권한이 없으면 퇴근 누락 안내 한 줄만
  // 「수정 요청」은 큐브티 기록만 — 10/25 이전 · 시프티에서 옮긴 기록(importBatch)은 서버가 받지 않는다(검증 B2)
  const canFix = (d: string, rec?: attendance.MyDayRecord) => d >= CUBETEE_ATTENDANCE_START && !rec?.imported;
  const pastRows: PastRow[] = [];
  for (let i = 1; i <= 7 && pastRows.length < 5; i++) {
    const d = addDaysYmd(today, -i);
    const rec = past?.find((r) => r.date === d);
    const lv = leaveOf(d);
    const sh = shiftOf(d);
    const isMissed = missed?.date === d;
    const pills: PastRow["pills"] = [];
    let fix: RequestDraft | undefined;
    if (lv && lv.status === "APPROVED" && !rec) pills.push({ text: LEAVE_LABELS[lv.type] || "휴가", tone: "blue" });
    else if (rec) {
      if (rec.status === "ABSENT") { pills.push({ text: "미출근", tone: "red" }); fix = { kind: "CORRECTION", workDate: d }; }
      else {
        pills.push(rec.status === "LATE" ? { text: "지각", tone: "red" } : { text: "출근", tone: "gray" });
        if (isMissed || rec.hasOut === false) { pills.push({ text: "퇴근 누락", tone: "red" }); fix = { kind: "MISSED_OUT", workDate: d }; }
        else if (rec.hasOut) pills.push(rec.status === "EARLY_LEAVE" ? { text: "조퇴", tone: "red" } : { text: "퇴근", tone: "gray" });
      }
    } else if (isMissed) {
      pills.push({ text: "출근", tone: "gray" }, { text: "퇴근 누락", tone: "red" });
      fix = { kind: "MISSED_OUT", workDate: d };
    } else if (past && sh) {
      pills.push({ text: "기록 없음", tone: "red" });
      fix = { kind: "CORRECTION", workDate: d };
    }
    // 서버가 시각을 풀어 준 날(본부가 승인한 출퇴근 기록 요청 기간)은 시각도 한 알약으로(2026-10-27 ⑦)
    if (rec && (rec.inAt || rec.outAt)) pills.push({ text: `${rec.inAt ? hhmm(rec.inAt) : "—"} → ${rec.outAt ? hhmm(rec.outAt) : "—"}${rec.granted ? " · 기록 요청 승인" : ""}`, tone: "blue" });
    if (fix && !canFix(d, rec)) fix = undefined;
    if (pills.length) pastRows.push({ date: d, pills, fix });
  }

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {/* 오늘 내 근무 */}
        <View style={styles.todayCard}>
          <View style={styles.rowBetween}>
            <Text style={styles.lab}>오늘 내 근무 · {fmtDay(today)}</Text>
            {!!placeText && <View style={styles.placeTag}><Text style={styles.placeText}>{placeText}</Text></View>}
          </View>
          <Text style={styles.big}>
            {todayShift ? fmtTime(todayShift.startTime, todayShift.endTime).replace("–", " – ") : todayLeave && todayLeave.status === "APPROVED" ? `휴가 · ${LEAVE_LABELS[todayLeave.type] || "휴가"}` : "근무 일정 없음"}
          </Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusUi.dot }]} />
            <Text style={styles.statusText}>{statusUi.text}</Text>
          </View>
        </View>

        {/* 어제 퇴근 누락 안내(#15) */}
        {missed && (
          <View style={styles.warnCard}>
            <Text style={styles.warnTitle}>{md(missed.date)} 퇴근 기록이 없어요</Text>
            {missed.canConsent && missed.closeHhmm ? (
              <>
                <Text style={styles.warnText}>근무일정 퇴근 시각({missed.closeHhmm})에 퇴근하셨다면 아래 동의로 바로 처리됩니다. 다른 시각이면 요청으로 넣어 주세요.</Text>
                <TouchableOpacity style={[styles.consentBtn, consenting && styles.buttonDisabled]} disabled={consenting} onPress={() => consentOut(missed)}>
                  {consenting ? <ActivityIndicator color="#fff" /> : <Text style={styles.consentText}>{missed.closeHhmm} 퇴근으로 처리하는 데 동의합니다</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <Text style={styles.warnText}>{missed.consentReason || "퇴근 시각을 넣어 요청해 주세요."}</Text>
            )}
            {canFix(missed.date) ? (
              <TouchableOpacity style={styles.outlineBtn} onPress={() => setDraft({ kind: "MISSED_OUT", workDate: missed.date })}>
                <Text style={styles.outlineText}>{missed.canConsent ? "다른 시각이에요 — 퇴근 처리 요청하기" : "퇴근 처리 요청하기"}</Text>
              </TouchableOpacity>
            ) : (
              <Text style={styles.warnText}>10월 25일까지는 시프티 기록이라 여기서 고치지 않습니다. 고칠 일이 있으면 본부에 문의해 주세요.</Text>
            )}
          </View>
        )}

        {/* 위치 인증 실패 안내(#13) — 반경 밖이면 지점 밖 요청, 3번 실패하면 사진·본부 요청 */}
        {fail && phase !== "DONE" && (
          <View style={styles.failCard}>
            <Text style={styles.failTitle}>{word} 위치를 확인하지 못했어요 ({fail.count}번째)</Text>
            <Text style={styles.failText}>{FAIL_TEXT[fail.reason]}{fail.detail ? ` ${fail.detail}` : ""}</Text>
            {fail.reason === "outside" && (location?.accuracy ?? 0) > 100 && (
              <>
                <Text style={styles.failText}>위치가 정확하지 않아요(오차 약 {Math.round(location?.accuracy ?? 0)}m). 폰 설정에서 큐브티 위치를 「정확한 위치」로 켜 주세요.{"\n"}아이폰: 설정 › 큐브티 › 위치 › 「정확한 위치」 켬 · 안드로이드: 설정 › 위치 › 「정확한 위치 사용」 켬(절전 모드도 꺼 주세요)</Text>
                <TouchableOpacity style={styles.outlineBtn} onPress={() => Linking.openSettings().catch(() => {})}>
                  <Text style={styles.outlineText}>폰 위치 설정 열기</Text>
                </TouchableOpacity>
              </>
            )}
            {fail.reason === "outside" && (
              <>
                <Text style={styles.failText}>본사·서점 등 지점 밖이라면 요청으로 {word}해 주세요.</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => openClockRequest("OUTSIDE")}>
                  <Text style={styles.primaryText}>지점 밖 {word} 요청하기 ›</Text>
                </TouchableOpacity>
              </>
            )}
            {fail.count >= 3 && (
              <>
                <Text style={styles.failSub}>다른 방법으로 {word}하기</Text>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => openClockRequest("PHOTO")}>
                  <Text style={styles.primaryText}>지점 사진 올려 {word} 요청 (원장 승인)</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.outlineBtn} onPress={() => openClockRequest("HQ")}>
                  <Text style={styles.outlineText}>본부에 {word} 처리 요청</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* 이번 주 일정(월~일) */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>이번 주 일정</Text>
          <View style={styles.wk7}>
            {Array.from({ length: 7 }, (_, i) => addDaysYmd(wk.start, i)).map((d) => {
              const sh = shiftOf(d), lv = leaveOf(d);
              const isToday = d === today;
              const leaveOn = !!lv && lv.status === "APPROVED";
              const kind = isToday ? "on" : leaveOn ? "v" : sh && isWeekend(d) ? "w" : sh ? "work" : "off";
              const sub = isToday ? "오늘" : leaveOn ? (LEAVE_LABELS[lv!.type] || "휴가").slice(0, 2) : sh && isWeekend(d) ? "주말" : sh ? "" : "쉼";
              return (
                <View key={d} style={[styles.wkDay, WK[kind]]} accessibilityLabel={`${fmtDay(d)} ${sh ? fmtTime(sh.startTime, sh.endTime) : leaveOn ? "휴가" : "쉬는 날"}`}>
                  <Text style={[styles.wkDow, { color: WK_INK[kind] }, kind === "off" && isWeekend(d) && { color: C.weekend }]}>{wd(d)}</Text>
                  <Text style={[styles.wkSub, { color: WK_SUB[kind] }]}>{sub}</Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* 지난 기록 — 날짜별 상태 알약(시각은 본부만) */}
        {(pastRows.length > 0 || canFix(addDaysYmd(today, -1)) || role !== "ADMIN") && <View style={styles.lst}>
          {pastRows.map((r, i) => (
            <View key={r.date} style={[styles.it, i > 0 && styles.itLine]}>
              <View style={styles.dy}>
                <Text style={[styles.dyDow, isWeekend(r.date) && { color: C.weekend }]}>{wd(r.date)}</Text>
                <Text style={styles.dyNum}>{md(r.date).split(" ")[0]}</Text>
              </View>
              <View style={styles.pills}>
                {r.pills.map((p, k) => (
                  <View key={k} style={[styles.pill, { backgroundColor: PILL[p.tone].bg }]}><Text style={[styles.pillText, { color: PILL[p.tone].fg }]}>{p.text}</Text></View>
                ))}
              </View>
              {r.fix && (
                <TouchableOpacity style={styles.fixBtn} onPress={() => setDraft(r.fix!)} accessibilityLabel={`${fmtDay(r.date)} 수정 요청`}>
                  <Text style={styles.link}>수정 요청 ›</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          {canFix(addDaysYmd(today, -1)) && (
            <TouchableOpacity style={[styles.it, pastRows.length > 0 && styles.itLine]} onPress={() => setDraft({ kind: "CORRECTION" })}>
              <Text style={styles.itBold}>출퇴근 기록 고치기 요청</Text>
              <Text style={[styles.link, { marginLeft: "auto" }]}>요청 ›</Text>
            </TouchableOpacity>
          )}
          {/* 출퇴근 기록 요청(시안 S1-1) — 찍은 시각은 본부만 보므로 기록이 필요하면 본부에 요청한다. 본부 계정은 직접 보므로 없음 */}
          {role !== "ADMIN" && (
            <TouchableOpacity style={[styles.it, (pastRows.length > 0 || canFix(addDaysYmd(today, -1))) && styles.itLine]} onPress={() => setDraft({ kind: "RECORD" })} accessibilityLabel="출퇴근 기록 요청 — 본부에 요청">
              <Text style={styles.itBold}>출퇴근 기록 요청</Text>
              <Text style={[styles.link, { marginLeft: "auto" }]}>본부에 요청 ›</Text>
            </TouchableOpacity>
          )}
        </View>}

        {/* 내 출퇴근 요청 */}
        {requests.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>내 출퇴근 요청</Text>
            {requests.map((r) => (
              <View key={r.id} style={styles.reqRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.reqMain}>{r.summary}</Text>
                  <Text style={styles.reqSub}>
                    <Text style={{ color: STATUS_COLOR[r.status], fontWeight: "700" }}>{STATUS_LABEL[r.status] ?? r.status}</Text>
                    {r.status === "PENDING" ? ` · 승인: ${r.approverLabel}` : r.decidedByName ? ` · ${r.decidedByName}` : ""}
                    {r.status === "REJECTED" && r.rejectReason ? ` · ${r.rejectReason}` : ""}
                  </Text>
                </View>
                {r.status === "PENDING" && (
                  <TouchableOpacity style={styles.fixBtn} onPress={() => cancelRequest(r)}>
                    <Text style={styles.cancelLink}>취소</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* 아래 고정 띠 — 큰 버튼 하나(출근하기 → 퇴근하기) */}
      <View style={styles.dock}>
        <Text style={styles.dockLine}>{dockLine}</Text>
        <TouchableOpacity
          style={[styles.button, buttonDisabled && styles.buttonOff]}
          onPress={handlePress}
          disabled={buttonDisabled}
          accessibilityLabel={buttonLabel}
        >
          {isLoading ? (relocating ? <Text style={styles.buttonText}>위치를 다시 잡는 중…</Text> : <ActivityIndicator color="#fff" />) : <Text style={[styles.buttonText, buttonDisabled && { color: C.muted }]}>{buttonLabel}</Text>}
        </TouchableOpacity>
      </View>

      <AttendanceRequestModal draft={draft} onClose={() => setDraft(null)} onDone={onRequestDone} />
    </View>
  );
}

const WK = StyleSheet.create({
  on: { backgroundColor: C.ind },
  v: { backgroundColor: C.blueBg },
  w: { backgroundColor: C.vioBg },
  work: { backgroundColor: "#eef1f6" },
  off: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.line },
});
const WK_INK: Record<string, string> = { on: "#fff", v: C.blueInk, w: C.vio, work: "#334155", off: C.muted };
const WK_SUB: Record<string, string> = { on: "#e0e7ff", v: C.blueInk, w: C.vio, work: C.muted, off: C.muted };

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1 },
  content: { padding: 14, paddingTop: 16, paddingBottom: 24, gap: 12 },
  todayCard: { backgroundColor: C.indBg, borderWidth: 1, borderColor: "#dfe5ff", borderRadius: 16, padding: 15 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  lab: { fontSize: 13.5, color: C.sub, fontWeight: "600", flexShrink: 1 },
  placeTag: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.indBd, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  placeText: { fontSize: 12.5, fontWeight: "700", color: C.indInk },
  big: { fontSize: 30, fontWeight: "800", color: C.ink, marginTop: 8, fontVariant: ["tabular-nums"] },
  statusRow: { flexDirection: "row", alignItems: "center", marginTop: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusText: { fontSize: 14.5, fontWeight: "600", color: "#334155", flexShrink: 1 },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 15 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: C.ink, marginBottom: 10 },
  wk7: { flexDirection: "row", gap: 4 },
  wkDay: { flex: 1, alignItems: "center", borderRadius: 9, paddingVertical: 7, minHeight: 50 },
  wkDow: { fontSize: 13, fontWeight: "700" },
  wkSub: { fontSize: 11.5, fontWeight: "600", marginTop: 2 },
  lst: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  it: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56 },
  itLine: { borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  itBold: { fontSize: 15, fontWeight: "700", color: C.ink },
  dy: { width: 44 },
  dyDow: { fontSize: 14, fontWeight: "700", color: "#334155" },
  dyNum: { fontSize: 12.5, color: C.muted, marginTop: 1 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, flex: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  pillText: { fontSize: 12.5, fontWeight: "700" },
  fixBtn: { minHeight: 44, justifyContent: "center", paddingLeft: 8 },
  link: { fontSize: 13.5, fontWeight: "700", color: C.ind },
  warnCard: { backgroundColor: C.ambBg, borderColor: C.ambBd, borderWidth: 1, borderRadius: 16, padding: 15 },
  warnTitle: { fontSize: 16, fontWeight: "700", color: C.amb },
  warnText: { fontSize: 14, color: "#92400e", marginTop: 4 },
  failCard: { backgroundColor: C.redBg, borderColor: C.redBd, borderWidth: 1, borderRadius: 16, padding: 15 },
  failTitle: { fontSize: 16, fontWeight: "700", color: "#9f1239" },
  failText: { fontSize: 14, color: "#7f1d1d", marginTop: 6 },
  failSub: { fontSize: 14, fontWeight: "700", color: C.ink, marginTop: 14 },
  primaryBtn: { backgroundColor: C.ind, borderRadius: 12, minHeight: 46, justifyContent: "center", alignItems: "center", marginTop: 10 },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  consentBtn: { backgroundColor: C.ind, borderRadius: 12, minHeight: 46, justifyContent: "center", alignItems: "center", marginTop: 10 },
  consentText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  outlineBtn: { backgroundColor: "#fff", borderWidth: 1, borderColor: C.indBd, borderRadius: 12, minHeight: 46, justifyContent: "center", alignItems: "center", marginTop: 10 },
  outlineText: { color: C.ind, fontSize: 15, fontWeight: "700" },
  reqRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  reqMain: { fontSize: 14, color: C.ink },
  reqSub: { fontSize: 13, color: C.sub, marginTop: 2 },
  cancelLink: { color: C.red, fontSize: 14, fontWeight: "700", paddingHorizontal: 8 },
  dock: { backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  dockLine: { textAlign: "center", fontSize: 13.5, color: C.sub, marginBottom: 8 },
  button: { height: 54, borderRadius: 14, backgroundColor: C.ind, alignItems: "center", justifyContent: "center" },
  buttonOff: { backgroundColor: "#e2e8f0" },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 17, fontWeight: "800" },
});
