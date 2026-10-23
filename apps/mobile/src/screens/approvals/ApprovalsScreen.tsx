import React, { useCallback, useEffect, useRef, useState } from "react";
import { LEAVE_LABELS, syncLeaveLabels } from "../../services/leaveLabels";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Linking,
  KeyboardAvoidingView,
  Platform,
  Image,
  AppState,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { fileUri, useUploadsTicketVersion } from "../../services/work";
import * as storage from "../../services/storage";
import * as attendance from "../../services/attendance";
import { getBranchDay } from "../../services/schedule";
import {
  getLeaveApprovals,
  getScheduleApprovals,
  decideLeave,
  decideSchedule,
  cancelLeave,
  cancelSchedule,
  getTeamLeaves,
  getLeaveCancelApprovals,
  decideLeaveCancel,
  getTeamBalances,
  getBranchSchedules,
  LeaveCancelInboxStep,
  LeaveInboxStep,
  ScheduleInboxStep,
  TeamLeave,
  confirmOverride,
} from "../../services/approvals";
import { refreshBadges, holdApproval, releaseApproval } from "../../services/badges";
import { C, fmtDay, fmtRange, fmtShort, fmtTime, isWeekend, stripTimes, todayYmd, weekOfYmd, ymd, wd, addDaysYmd } from "../../services/fmt";

// 승인(2026-10-23 본부 요청 앱 2 · 3, 시안 S2-2 · S2-4)
//  · 카드마다 「반려」 「승인」 두 개. 의견은 반려할 때, 취소 · 결재 순서 · 첨부는 카드를 눌러 상세에서
//  · 승인하면 카드가 접히고 위에 「N초 뒤 보냅니다 · 되돌리기」 띠 — 서버에 되돌리는 기능이 없어 **5초 뒤에 실제로 보낸다**(그 안에 되돌리면 아무것도 안 보냄).
//    화면을 떠나거나 앱이 뒤로 가면 기다리지 않고 바로 보낸다(누른 승인이 사라지지 않게).
//    같은 건은 한 번만 보낸다(대기 중 · 보낸 건은 다시 눌러도 무시), 보낸 건은 서버 응답 뒤 목록을 새로 읽을 때까지 접어 둔다(검증 B1).
//    잔여 부족(본부 예외 승인)이 보이면 유예 전에 이름과 함께 먼저 묻는다. 유예 중인 건은 아래 탭 숫자에서도 빠진다
//  · 출퇴근 수정은 「지점 원장 → 본부」 두 단계(■0-11): 원장 카드에 「시각 확인은 본부 단계에서」, 본부 카드에 원장 승인 이름 · 시각.
//    원장이 승인하면 서버 안내(「1차 승인했습니다. 본부가 시각을 확인해 최종 승인합니다.」)를 띠에 보인다
//  · 원장대행 직원(역할 EMPLOYEE)은 서버가 본인 일정만 주므로 「주 52시간」 · 「그날 근무 N명」 줄을 그리지 않는다(검증 A1)
//  · 판단 정보를 카드 안에: 근무 변경 = 주 52시간 안 / 넘음(일정 기준, 숫자 없음) · 그날 지점 근무 인원, 휴가 = 남은 연차 · 그날 인원,
//    출퇴근 수정 = 상태만(시각은 본부 — ■0-11, 본부 계정은 지금처럼 시각도)
//  · 종류 알약(전체 · 근무 변경 · 휴가 · 출퇴근 수정)은 10건 이상일 때만, 누르는 자리 44
//  · 지점 휴가: 오늘 → 다가오는 순 한 줄씩, 승인 = 파랑 글자, 승인 대기 = 주황 알약. 결재 기록 · 안내는 눌렀을 때만

const LEAVE_TYPE_LABEL: Record<string, string> = LEAVE_LABELS;   // 공용 객체 — syncLeaveLabels 가 본부 유형 이름을 채운다(#216-1)
const ANNUAL = new Set(["ANNUAL", "HALF_AM", "HALF_PM", "QUARTER_AM", "QUARTER_PM"]);   // 연차에서 빠지는 유형(남은 연차 표시용)
const GRACE_MS = 5000;

// 취소 불가 사유(서버 cancelBlock) → 짧은 표시 (웹 원장 화면과 같은 표)
const CANCEL_BLOCK_LABEL: Record<string, string> = {
  PAST: "지난 휴가라 취소할 수 없습니다.",
  NEEDS_REQUEST: "승인된 휴가 — 본인이 취소 요청을 올려야 합니다.",
  IN_REVIEW: "원장이 승인한 휴가 — 본인은 바로 취소할 수 없습니다.",
  MAIN_ONLY: "다른 원장의 신청 — 대표원장만 취소할 수 있습니다.",
};

type Kind = "SCHEDULE" | "LEAVE" | "LEAVE_CANCEL" | "ATTENDANCE";
// 묶음(종류 알약) — 요청 종류 이름은 세 가지 「근무 변경 · 휴가 · 출퇴근 수정」(■4, 웹 결재함 탭과 같게). 카드 · 띠에 쓰는 이름은 Item.groupName(지점 밖 · 사진 · 기록 요청은 내용 설명으로)
type Group = "근무 변경" | "휴가" | "출퇴근 수정";
const GROUP_OF: Record<Kind, Group> = { SCHEDULE: "근무 변경", LEAVE: "휴가", LEAVE_CANCEL: "휴가", ATTENDANCE: "출퇴근 수정" };
type Tone = "ind" | "amb" | "red" | "blue" | "vio" | "gray";
const TONE: Record<Tone, { fg: string; bg: string }> = {
  ind: { fg: C.indInk, bg: C.indBg }, amb: { fg: C.amb, bg: C.ambBg }, red: { fg: C.red, bg: C.redBg },
  blue: { fg: C.blueInk, bg: C.blueBg }, vio: { fg: C.vio, bg: C.vioBg }, gray: { fg: C.gray, bg: C.grayBg },
};
function Pill({ text, tone }: { text: string; tone: Tone }) {
  return <View style={[styles.pill, { backgroundColor: TONE[tone].bg }]}><Text style={[styles.pillText, { color: TONE[tone].fg }]}>{text}</Text></View>;
}
/** 유예 띠의 남은 초 — 이 작은 글자만 250ms 마다 다시 그린다(화면 전체 · 카드 목록은 그대로) */
function GraceLeft({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [until]);
  return <Text>{Math.min(GRACE_MS / 1000, Math.max(1, Math.ceil((until - now) / 1000)))}</Text>;
}
type Line = { label?: string; text: string; tone?: "red" | "bold" };
type Step = { id: string; order: number; status: string; approverRole?: string | null; branch?: string | null; approver?: { id: string; name: string } | null; comment?: string | null };
type Item = {
  key: string; kind: Kind; id: string;   // id = 결재 API 에 넘기는 신청 id
  who: string; userId?: string; branch: string | null; position: string | null;
  title: string; summary: string;        // title = 카드 큰 글씨, summary = 되돌리기 띠 · 홈 목록 한 줄
  tag?: { text: string; tone: Tone };
  lines: Line[];
  sortKey: string;
  reason?: string | null;
  attachment?: { url: string; name: string } | null;
  hasPhoto?: boolean;
  steps?: Step[];
  canCancel?: boolean;
  cancelKind?: "leave" | "schedule";
  firstDate?: string;                    // 그날 지점 인원 계산용
  dates?: { date: string; startTime: string; endTime: string }[];
  schedKind?: string;
  leaveDays?: number; leaveType?: string;
  groupName?: string;                    // 카드 · 띠 · 홈에 쓰는 종류 이름(없으면 묶음 이름)
  override?: boolean;                    // 잔여 부족 예외 승인을 이미 확인받음(휴가)
};
const nameOf = (it: Item) => it.groupName ?? GROUP_OF[it.kind];
const hhmmOf = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// 하루 근무(휴게 제외) — 웹 schedule-payload 와 같은 규칙(4.5시간↑ 30분, 9시간↑ 1시간)
const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})$/.exec(t || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const netMin = (s: string, e: string) => {
  const a = toMin(s), b = toMin(e);
  if (a == null || b == null || b <= a) return 0;
  const span = b - a;
  return span - (span >= 540 ? 60 : span >= 270 ? 30 : 0);
};
const hoursText = (m: number) => `${Math.round((m / 60) * 10) / 10}시간`;
// 결재 순서 — 「평촌 원장 ✓ → 본부」. 이관 메모(「시프티 이관」)는 화면에 보이지 않게(■4)
const roleLabel = (s: Step) => (s.approverRole === "ADMIN" ? "본부" : s.approverRole === "MANAGER" ? `${s.branch ? `${s.branch} ` : ""}원장` : "결재자");
const cleanComment = (c?: string | null) => (c && !/시프티\s*이관/.test(c) ? c : "");
const chainText = (steps: Step[]) =>
  steps.map((x) => `${x.status === "APPROVED" && x.approver ? x.approver.name : roleLabel(x)}${x.status === "APPROVED" ? " ✓" : x.status === "REJECTED" ? " (반려)" : ""}`).join(" → ");

function schedItem(step: ScheduleInboxStep): Item {
  const r = step.scheduleRequest;
  const days = (Array.isArray(r.scheduleData) ? r.scheduleData : []).filter((d) => d && d.date).map((d) => ({ date: ymd(d.date), startTime: d.startTime, endTime: d.endTime })).sort((a, b) => a.date.localeCompare(b.date));
  const first = days[0];
  const kind = r.kind || "CREATE";
  const time = first ? fmtTime(first.startTime, first.endTime) : stripTimes(r.templateName);
  const sameTime = days.every((d) => d.startTime === first?.startTime && d.endTime === first?.endTime);
  const weekend = days.some((d) => isWeekend(d.date));
  const tag = kind === "DELETE" ? { text: "일정 빼기", tone: "gray" as Tone } : weekend ? { text: "주말 근무", tone: "vio" as Tone } : kind === "UPDATE" ? { text: "시간 변경", tone: "ind" as Tone } : undefined;
  const dayLine = days.length <= 1 ? fmtDay(first?.date || ymd(r.startDate)) : `${fmtRange(days[0].date, days[days.length - 1].date)} · ${days.length}일`;
  const timeLine = kind === "DELETE" ? `${time} 근무 빼기` : `${sameTime ? time : `${time} 등`}${first ? ` · ${hoursText(netMin(first.startTime, first.endTime))}` : ""}`;
  const name = stripTimes(r.templateName);
  return {
    key: `S:${step.id}`, kind: "SCHEDULE", id: r.id, who: r.user.name, userId: r.user.id, branch: r.user.branch ?? null, position: r.user.position ?? null,
    title: `${dayLine}\n${timeLine}`,
    summary: `${days.length <= 1 ? fmtDay(first?.date || ymd(r.startDate)) : fmtRange(days[0]?.date || ymd(r.startDate), days[days.length - 1]?.date || ymd(r.endDate))} ${kind === "DELETE" ? "근무 빼기" : time}${weekend && kind !== "DELETE" ? " · 주말 근무" : ""}`,
    tag, lines: [
      ...(name && name !== "근무일정 삭제" && !/^직접 입력$/.test(name) ? [{ label: "근무", text: name }] : []),
      ...(r.reason ? [{ label: "사유", text: r.reason }] : []),
    ],
    sortKey: first?.date || ymd(r.startDate), reason: r.reason, steps: (r.approvalSteps as Step[]) || [],
    canCancel: r.canCancel, cancelKind: "schedule", firstDate: first?.date, dates: days, schedKind: kind,
  };
}

function leaveItem(step: LeaveInboxStep): Item {
  const r = step.leaveRequest;
  const type = LEAVE_TYPE_LABEL[r.type] || r.type;
  return {
    key: `L:${step.id}`, kind: "LEAVE", id: r.id, who: r.user.name, userId: r.user.id, branch: r.user.branch ?? null, position: r.user.position ?? null,
    title: `${type} ${fmtRange(r.startDate, r.endDate)} · ${r.days}일`,
    summary: `${type} ${fmtRange(r.startDate, r.endDate)} · ${r.days}일`,
    lines: r.reason ? [{ label: "사유", text: r.reason }] : [],
    sortKey: ymd(r.startDate), reason: r.reason,
    attachment: r.attachmentUrl ? { url: r.attachmentUrl, name: r.attachmentName || "첨부 보기" } : null,
    steps: (r.approvalSteps as Step[]) || [], canCancel: r.canCancel, cancelKind: "leave", firstDate: ymd(r.startDate),
    leaveDays: r.days, leaveType: r.type,
  };
}

function cancelItem(step: LeaveCancelInboxStep): Item {
  const c = step.cancelRequest;
  const r = c.leaveRequest;
  const type = LEAVE_TYPE_LABEL[r.type] || r.type;
  return {
    key: `C:${step.id}`, kind: "LEAVE_CANCEL", id: c.id, who: c.user.name, userId: c.user.id, branch: c.user.branch ?? null, position: c.user.position ?? null,
    title: `${type} ${fmtRange(r.startDate, r.endDate)} · ${r.days}일 취소`,
    summary: `${type} ${fmtRange(r.startDate, r.endDate)} 취소`,
    tag: { text: "휴가 취소", tone: "gray" },
    lines: [...(c.reason ? [{ label: "취소 사유", text: c.reason }] : []), { text: "승인하면 휴가가 취소되고 연차가 돌아갑니다. 반려하면 휴가는 그대로입니다." }],
    sortKey: ymd(r.startDate), steps: (c.approvalSteps as Step[]) || [],
  };
}

// 출퇴근 요청 — 시각을 못 보는 사람(직원 · 원장)은 상태만(넣을 시각은 본부 단계에서, ■0-11). 시각을 보는 사람(본부 · 「출퇴근 시각 보기」 켠 원장)은
// 서버 요약(시각 포함) 그대로. 판정은 서버 timesHidden — 옛 서버라 없으면 역할(본부)로(검증 B4)
function attItem(r: attendance.AttendanceRequestRow, admin: boolean): Item {
  const showTimes = typeof r.timesHidden === "boolean" ? !r.timesHidden : admin;
  const day = r.workDate ? fmtDay(ymd(r.workDate)) : "";
  const io = r.action === "OUT" ? "퇴근" : "출근";
  const fix = r.kind === "MISSED_OUT" || r.kind === "CORRECTION";
  const plain =
    r.kind === "MISSED_OUT" ? `${day} 퇴근 누락 → 퇴근`
    : r.kind === "CORRECTION" ? `${day} 출퇴근 기록 고치기`
    : r.kind === "OUTSIDE" ? `${day} 지점 밖 ${io}`
    : r.kind === "PHOTO" ? `${day} 사진으로 ${io}`
    : r.kind === "HQ" ? `${day} 본부 처리 ${io}`
    : r.kind === "RECORD" ? (r.summary || "출퇴근 기록 요청")   // 「출퇴근 기록 요청 · 10월 1일 (목) ~ 10월 23일 (금) · 쓰는 곳」(시각 없음)
    : `새 기기 · ${r.deviceName ?? "이름 없음"}`;
  const lines: Line[] = [];
  if (fix) {
    // 그날 기록 상태(시각 없이) — 서버가 주면 그것(「출근 · 퇴근 누락」), 옛 서버면 퇴근 누락만
    const state = r.recordState ?? (r.kind === "MISSED_OUT" ? "출근 · 퇴근 누락" : null);
    if (state) lines.push({ label: "기록", text: state, tone: /누락|없음/.test(state) ? "red" : undefined });
  }
  if (r.reason) lines.push({ label: r.kind === "RECORD" ? "쓰는 곳" : "사유", text: r.reason });
  if (r.memo) lines.push({ label: "메모", text: r.memo });
  if (r.hasPhoto) lines.push({ label: "사진", text: "카드를 눌러서 보기" });
  if (showTimes && r.createdAt) lines.push({ label: "접수", text: new Date(r.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) });
  // 두 단계(원장 → 본부) 진행 — 원장 차례면 「시각 확인은 본부 단계에서」, 본부 차례면 1차 승인한 원장 이름 · 시각
  if (fix && r.step1) {
    const at = new Date(r.step1.at);
    lines.push({ text: `원장 승인 완료 · ${r.step1.name}${Number.isNaN(at.getTime()) ? "" : ` · ${fmtShort(ymd(at))} ${hhmmOf(at)}`}`, tone: "bold" });
  }
  if (fix && r.currentStep === "MANAGER" && r.nextStep === "HQ") lines.push({ text: "시각 확인은 본부 단계에서" });
  if (r.kind === "RECORD") lines.push({ text: "승인해도 출퇴근 기록은 바뀌지 않습니다. 기록은 따로 전해 주세요." });
  const progress: Item["tag"] =
    !fix ? undefined
    : r.currentStep === "MANAGER" && r.nextStep === "HQ" ? { text: "1/2 원장 차례", tone: "amb" }
    : r.currentStep === "HQ" && r.step1 ? { text: "2/2 본부 차례", tone: "amb" }
    : undefined;
  return {
    key: `A:${r.id}`, kind: "ATTENDANCE", id: r.id, who: r.userName, userId: r.userId, branch: r.userBranch, position: r.userPosition,
    title: showTimes && r.kind !== "DEVICE" && r.kind !== "RECORD" ? r.summary : plain, summary: plain,
    groupName: fix ? "출퇴근 수정" : r.kind === "RECORD" ? "출퇴근 기록 요청" : r.kindLabel,
    tag: progress,
    lines, sortKey: ymd(r.workDate || r.createdAt || r.createdDate), hasPhoto: r.hasPhoto,
  };
}

export default function ApprovalsScreen() {
  useUploadsTicketVersion(); // 첨부·계약서 티켓이 첫 렌더보다 늦게 와도 다시 그려지게(2026-10-06)
  const [leave, setLeave] = useState<LeaveInboxStep[]>([]);
  const [schedule, setSchedule] = useState<ScheduleInboxStep[]>([]);
  const [cancelReqs, setCancelReqs] = useState<LeaveCancelInboxStep[]>([]);   // 휴가 취소 결재(9/11)
  const [attReqs, setAttReqs] = useState<attendance.AttendanceRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<"inbox" | "history">("inbox");
  const [filter, setFilter] = useState<Group | "">("");
  // 원장대행 직원은 결재만 한다 — 「지점 휴가」는 원장 팀 화면이라 숨긴다(웹과 같게)
  const [myRole, setMyRole] = useState("");
  const [myId, setMyId] = useState("");
  const delegateOnly = myRole === "EMPLOYEE";
  const admin = myRole === "ADMIN";
  // 판단 정보 중 지점 일정 · 인원 줄(주 52시간 · 그날 근무 N명)은 원장 · 본부만 — 원장대행 직원은 서버가 본인 것만 줘서 틀린 숫자가 된다(검증 A1)
  const fullCtx = myRole === "MANAGER" || myRole === "ADMIN";
  const [history, setHistory] = useState<TeamLeave[]>([]);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [openHist, setOpenHist] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Item | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [detail, setDetail] = useState<Item | null>(null);
  const [photoView, setPhotoView] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  // 판단 정보(카드 안 회색 칸) — 늦게 와도 카드는 먼저 보인다
  const [ctx, setCtx] = useState<Record<string, Line[]>>({});
  // 잔여 부족이 보이는 휴가 카드(key → 남은 연차) — 본부는 유예 전에 예외 승인을 먼저 묻는다(검증 B1-d)
  const [short, setShort] = useState<Map<string, number>>(new Map());
  // 승인 유예(되돌리기) — 접힌 카드 · 보내기 전 승인 하나
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<{ item: Item; until: number } | null>(null);
  const pendingRef = useRef<{ item: Item; timer: ReturnType<typeof setTimeout> } | null>(null);
  // 보낸 승인 — key → 응답 뒤 처음 시작한 목록 읽기 번호(0 = 아직 응답 전). 그 번호 이후의 읽기가 화면에 반영될 때 접은 카드를 푼다(검증 B1-b)
  const sentRef = useRef<Map<string, number>>(new Map());
  const [notice, setNotice] = useState<string | null>(null);   // 보낸 뒤 안내(원장 1차 승인 등)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = useCallback((text: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  }, []);
  useEffect(() => () => { if (noticeTimer.current) clearTimeout(noticeTimer.current); }, []);
  // 유예 띠의 남은 초는 GraceLeft(아래 별도 컴포넌트)가 혼자 센다 — 250ms 마다 이 화면 전체(카드 목록)를 다시 그리면
  // 다른 카드의 승인 · 반려 누름이 사라졌다(검증 지적 10/23)

  useEffect(() => {
    storage.getUser().then((u) => { setMyId(u?.id || ""); setMyRole(u?.role || ""); }).catch(() => {});
  }, []);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const my = ++loadSeq.current;
    try {
      const [l, s, h, c, a] = await Promise.all([
        getLeaveApprovals(),
        getScheduleApprovals(),
        getTeamLeaves().catch(() => null),   // 내역 실패가 결재함까지 막지 않게
        getLeaveCancelApprovals().catch(() => [] as LeaveCancelInboxStep[]),
        attendance.getAttendanceRequestInbox().catch(() => [] as attendance.AttendanceRequestRow[]),   // 실패해도 휴가 · 근무 변경은 보여 준다
        syncLeaveLabels().catch(() => {}),
      ]);
      if (my !== loadSeq.current) return;
      setLeave(l); setSchedule(s); setCancelReqs(c); setAttReqs(a);
      // 응답이 온 뒤 시작한 읽기가 반영됐다 — 그 승인 카드는 이제 서버 목록대로(성공이면 없고, 실패면 다시 보인다)
      const done = [...sentRef.current].filter(([, n]) => n > 0 && n <= my).map(([k]) => k);
      if (done.length) {
        for (const k of done) sentRef.current.delete(k);
        setHidden((p) => { const n = new Set(p); for (const k of done) n.delete(k); return n; });
      }
      setHistoryFailed(h === null);
      // 실패하면 비운다 — 옛 목록이 실패 문구와 함께 남으면 지금 상태로 오해한다(9/10 검증 지적)
      setHistory(h ?? []);
      setFailed(false);
    } catch (error) {
      console.error("Failed to load approvals:", error);
      if (my === loadSeq.current) setFailed(true);
    } finally {
      if (my === loadSeq.current) { setLoading(false); setRefreshing(false); }
    }
  }, []);
  // 아래 탭이 됐다(10/23) — 들어올 때마다 다시 읽는다
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
    refreshBadges().catch(() => {});
  }, [load]);

  const items: Item[] = [
    ...schedule.map(schedItem),
    ...leave.map(leaveItem),
    ...cancelReqs.map(cancelItem),
    ...attReqs.map((r) => attItem(r, admin)),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  // ── 판단 정보 모으기: 주 52시간(일정 기준) · 그날 지점 인원 · 남은 연차 ──
  const ctxKey = items.map((i) => i.key).join(",");
  useEffect(() => {
    if (!items.length) return;
    let alive = true;
    (async () => {
      const out: Record<string, Line[]> = {};
      const today = todayYmd();
      // 남은 연차(휴가 카드가 있을 때만)
      const needBal = items.some((i) => i.kind === "LEAVE" && i.leaveType && ANNUAL.has(i.leaveType));
      const bal = needBal ? await getTeamBalances().catch(() => null) : null;
      const shortOut = new Map<string, number>();
      // 그날 인원 — 날짜별 한 번만 부른다(원장 · 본부만)
      const dates = fullCtx ? [...new Set(items.filter((i) => i.firstDate && (i.kind === "SCHEDULE" || i.kind === "LEAVE")).map((i) => i.firstDate!))].slice(0, 8) : [];
      const dayRes = await Promise.all(dates.map((d) => getBranchDay(d).then((r) => [d, r] as const).catch(() => null)));
      const dayMap = new Map(dayRes.filter((x): x is NonNullable<typeof x> => !!x));
      const schedCache = new Map<string, Promise<Awaited<ReturnType<typeof getBranchSchedules>>>>();   // 같은 기간은 한 번만
      for (const it of items) {
        const lines: Line[] = [];
        if (fullCtx && it.kind === "SCHEDULE" && it.dates?.length) {
          // 주 52시간 — 그 사람의 그 주(월~일) 일정에 이 요청을 덮어 센다. 숫자 대신 「안 / 넘음」만(■0-11)
          try {
            const first = it.dates[0].date, last = it.dates[it.dates.length - 1].date;
            const from = weekOfYmd(first).start, to = weekOfYmd(last).end;
            if (to.localeCompare(addDaysYmd(from, 70)) <= 0) {
              const ck = `${from}|${to}`;
              if (!schedCache.has(ck)) schedCache.set(ck, getBranchSchedules(from, to));
              const shifts = (await schedCache.get(ck)!).filter((x) => x.userId === it.userId && String(x.type).toLowerCase() === "work");
              const m = new Map<string, { s: string; e: string }>();
              for (const x of shifts) m.set(ymd(x.date), { s: x.startTime, e: x.endTime });
              for (const d of it.dates) { if (it.schedKind === "DELETE") m.delete(d.date); else m.set(d.date, { s: d.startTime, e: d.endTime }); }
              const weeks = new Map<string, number>();
              for (const [d, v] of m) { const w = weekOfYmd(d).start; weeks.set(w, (weeks.get(w) ?? 0) + netMin(v.s, v.e)); }
              const touched = [...new Set(it.dates.map((d) => weekOfYmd(d.date).start))];
              const over = touched.some((w) => (weeks.get(w) ?? 0) > 52 * 60);
              const label = touched.length > 1 ? "주별 일정" : touched[0] === weekOfYmd(today).start ? "이번 주 일정" : `${fmtShort(touched[0])} 주 일정`;
              lines.push({ label, text: over ? "52시간 넘음" : "52시간 안", tone: over ? "red" : "bold" });
            }
          } catch { /* 못 세면 줄을 그리지 않는다 */ }
        }
        if (it.kind === "LEAVE" && bal && it.userId && it.leaveType && ANNUAL.has(it.leaveType)) {
          const rem = bal.get(it.userId);
          if (rem != null) lines.push({ label: "남은 연차", text: `${rem}일 → 승인하면 ${Math.round((rem - (it.leaveDays ?? 0)) * 10) / 10}일`, tone: rem - (it.leaveDays ?? 0) < 0 ? "red" : undefined });
          if (rem != null && rem - (it.leaveDays ?? 0) < 0) shortOut.set(it.key, rem);
        }
        if (fullCtx && (it.kind === "SCHEDULE" || it.kind === "LEAVE") && it.firstDate && dayMap.has(it.firstDate)) {
          const rows = dayMap.get(it.firstDate)!.employees.filter((r) => !it.branch || r.branch === it.branch);
          const working = rows.filter((r) => r.id !== it.userId && !["LEAVE", "OFF", "HOLIDAY", "NO_SCHEDULE"].includes(r.status)).length;
          const onLeave = rows.filter((r) => r.id !== it.userId && r.status === "LEAVE").length;
          const place = `${fmtShort(it.firstDate)} ${it.branch || "지점"}`;
          if (it.kind === "SCHEDULE") {
            const n = working + (it.schedKind === "DELETE" ? 0 : 1);
            lines.push({ label: `${place} 근무`, text: it.schedKind === "DELETE" ? `빼면 ${n}명` : `${it.who} 포함 ${n}명` });
          } else {
            lines.push({ label: `${place} 근무`, text: `${working}명${onLeave ? ` · 다른 휴가 ${onLeave}명` : ""}` });
          }
        }
        if (lines.length) out[it.key] = lines;
      }
      if (alive) { setCtx(out); setShort(shortOut); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxKey, fullCtx]);

  // ── 승인 보내기(유예 끝 · 화면을 떠날 때) ──
  const commit = useCallback(async (it: Item) => {
    sentRef.current.set(it.key, 0);   // 응답 전 — 카드는 접어 둔 채로, 다시 눌러도 보내지 않는다
    let told: string | null = null;
    try {
      if (it.kind === "LEAVE") await decideLeave(it.id, "approve", undefined, { override: it.override, who: it.who });
      else if (it.kind === "LEAVE_CANCEL") await decideLeaveCancel(it.id, "approve");
      else if (it.kind === "ATTENDANCE") {
        const r = await attendance.decideAttendanceRequest(it.id, "approve");
        // 원장 1차 승인(본부 최종 대기) · 기록 요청은 서버 안내를 그대로 띠에
        if (r.message && (r.step === "HQ" || it.groupName === "출퇴근 기록 요청")) told = r.message;
      }
      else await decideSchedule(it.id, "approve");
    } catch (error: any) {
      Alert.alert("승인하지 못했습니다", `${it.who}님 ${it.summary}\n${error?.response?.data?.error || "처리 중 오류가 발생했습니다."}`);
    } finally {
      // 응답이 왔다 — 다음에 시작하는 목록 읽기가 반영될 때 접은 카드를 푼다(그 전에 늦게 온 옛 목록이 카드를 되살리지 않게)
      sentRef.current.set(it.key, loadSeq.current + 1);
      releaseApproval();
      if (told) showNotice(`${it.who}님 · ${told}`);
      await load();
      refreshBadges().catch(() => {});
    }
  }, [load, showNotice]);
  const flush = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    setPending(null);
    void commit(p.item);
  }, [commit]);
  // 화면을 떠나거나(탭 이동 · 뒤로) 앱이 뒤로 가면 기다리지 않고 보낸다
  useFocusEffect(useCallback(() => () => flush(), [flush]));
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active") flush(); });
    return () => { sub.remove(); flush(); };
  }, [flush]);

  const startGrace = (it: Item) => {
    if (pendingRef.current?.item.key === it.key || sentRef.current.has(it.key)) return;
    flush();   // 앞에 기다리던 승인은 바로 보낸다
    setHidden((p) => new Set(p).add(it.key));
    holdApproval(1);   // 유예 중 숫자 새로 고침에서도 이 건은 빠진다(검증 B1-e)
    const timer = setTimeout(() => {
      if (pendingRef.current?.item.key !== it.key) return;
      pendingRef.current = null;
      setPending(null);
      void commit(it);
    }, GRACE_MS);
    pendingRef.current = { item: it, timer };
    setPending({ item: it, until: Date.now() + GRACE_MS });
    setDetail(null);
  };
  const approve = (it: Item) => {
    // 같은 건이 두 번 나가지 않게 — 유예 중이거나 이미 보낸 건은 무시(검증 B1-a)
    if (pendingRef.current?.item.key === it.key || sentRef.current.has(it.key)) return;
    // 잔여 부족 — 본부는 예외 승인할 수 있다. 5초 뒤에 물으면 어느 카드였는지 모르니 유예 전에 이름과 함께 먼저 묻는다(검증 B1-d)
    const rem = short.get(it.key);
    if (admin && it.kind === "LEAVE" && rem != null && !it.override) {
      setDetail(null);
      void confirmOverride(`${it.summary}\n남은 연차 ${rem}일보다 많습니다.`, it.who).then((ok) => { if (ok) startGrace({ ...it, override: true }); });
      return;
    }
    startGrace(it);
  };
  const undo = () => {
    const p = pendingRef.current;
    if (!p) return;
    clearTimeout(p.timer);
    pendingRef.current = null;
    setPending(null);
    setHidden((s) => { const n = new Set(s); n.delete(p.item.key); return n; });
    holdApproval(-1);
  };

  const confirmReject = async () => {
    const it = rejectTarget;
    if (!it) return;
    const reason = rejectReason.trim() || undefined;
    setProcessingId(it.key);
    try {
      if (it.kind === "LEAVE") await decideLeave(it.id, "reject", reason);
      else if (it.kind === "LEAVE_CANCEL") await decideLeaveCancel(it.id, "reject", reason);
      else if (it.kind === "ATTENDANCE") await attendance.decideAttendanceRequest(it.id, "reject", reason);
      else await decideSchedule(it.id, "reject", reason);
      setRejectTarget(null); setRejectReason(""); setDetail(null);
      await load();
      refreshBadges().catch(() => {});
    } catch (error: any) {
      Alert.alert("반려하지 못했습니다", error?.response?.data?.error || "처리 중 오류가 발생했습니다.");
    } finally {
      setProcessingId(null);
    }
  };

  // 취소 — 반려와 다르다. 반려는 결재 결과로 기록에 남고, 취소는 신청 자체를 거둔다.
  // 잘못 낸 신청을 반려로 처리하면 기록에 "반려당함"으로 남아 나중에 오해를 산다.
  const cancel = async (kind: "leave" | "schedule", id: string, who: string, opts: { approved?: boolean; ownerId?: string } = {}) => {
    const me = myId || (await storage.getUser().catch(() => null))?.id || "";
    const mine = !!opts.ownerId && opts.ownerId === me;
    Alert.alert(
      "신청 취소",
      mine
        ? "내 휴가 신청을 취소할까요?"
        : `${who}님의 신청을 취소할까요?${opts.approved ? "\n승인된 휴가라 차감된 연차가 되돌아갑니다." : ""}\n\n반려와 달리 결재 기록에 남지 않고, 신청자에게 알림이 갑니다.`,
      [
        { text: "닫기", style: "cancel" },
        {
          text: "취소하기", style: "destructive",
          onPress: async () => {
            setProcessingId(id);
            try {
              if (kind === "leave") await cancelLeave(id); else await cancelSchedule(id);
              setDetail(null);
              await load();
              refreshBadges().catch(() => {});
            } catch (error: any) {
              Alert.alert("취소하지 못했습니다", error?.response?.data?.error || "처리 중 오류가 발생했습니다.");
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={C.ind} />
      </View>
    );
  }

  const visible = items.filter((i) => !hidden.has(i.key));
  const total = visible.length;
  const showFilter = total >= 10;
  const shown = showFilter && filter ? visible.filter((i) => GROUP_OF[i.kind] === filter) : visible;
  const today = todayYmd();
  const hist = [...history].sort((a, b) => ymd(a.startDate).localeCompare(ymd(b.startDate)) || a.user.name.localeCompare(b.user.name, "ko"));
  const inboxIds = new Set(leave.map((l) => l.leaveRequest.id));

  // 카드 조각은 컴포넌트가 아니라 그리는 함수로 부른다 — 렌더 안에서 만든 컴포넌트는 그릴 때마다 새 종류라
  // 카드 속 버튼이 통째로 다시 만들어져 누르던 중인 터치가 사라진다(검증 지적 10/23)
  const infoBox = (it: Item) => {
    const all = [...it.lines, ...(ctx[it.key] || [])];
    if (!all.length) return null;
    return (
      <View style={styles.info}>
        {all.map((l, i) => (
          <Text key={i} style={styles.infoText}>
            {l.label ? `${l.label} · ` : ""}
            <Text style={l.tone === "red" ? styles.infoRed : l.tone === "bold" ? styles.infoBold : undefined}>{l.text}</Text>
          </Text>
        ))}
      </View>
    );
  };
  const buttons = (it: Item) => (
    <View style={styles.btn2}>
      <TouchableOpacity style={styles.bNo} onPress={() => { setRejectReason(""); setRejectTarget(it); }} disabled={processingId === it.key} accessibilityLabel={`${it.who} 반려`}>
        <Text style={styles.bNoText}>반려</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.bOk} onPress={() => approve(it)} disabled={processingId === it.key} accessibilityLabel={`${it.who} 승인`}>
        <Text style={styles.bOkText}>승인</Text>
      </TouchableOpacity>
    </View>
  );
  const head = (it: Item) => (
    <View style={styles.cardHead}>
      <Text style={styles.who} numberOfLines={1}>{it.who}</Text>
      <Text style={styles.headSub} numberOfLines={1}>{[admin ? it.branch : null, it.position && it.position !== "-" ? it.position : null, nameOf(it)].filter(Boolean).join(" · ")}</Text>
      {it.tag && <View style={{ marginLeft: "auto" }}><Pill text={it.tag.text} tone={it.tag.tone} /></View>}
    </View>
  );

  const overlays = (
    <>
      {/* 반려 — 의견은 여기서 */}
        <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => { setRejectTarget(null); setRejectReason(""); }}>
          <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === "ios" ? "padding" : undefined}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>반려</Text>
              {!!rejectTarget && <Text style={styles.modalSub}>{rejectTarget.who}님 · {rejectTarget.summary}</Text>}
              <TextInput
                style={styles.input}
                placeholder="반려 의견 (선택) — 신청자에게 그대로 전달됩니다"
                placeholderTextColor="#94a3b8"
                value={rejectReason}
                onChangeText={setRejectReason}
                multiline
              />
              <View style={styles.modalBtns}>
                <TouchableOpacity style={styles.modalCancel} onPress={() => { setRejectTarget(null); setRejectReason(""); }}>
                  <Text style={styles.modalCancelText}>닫기</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirm} onPress={confirmReject} disabled={!!processingId}>
                  {processingId ? <ActivityIndicator color="#fff" /> : <Text style={styles.modalConfirmText}>반려하기</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
        <Modal visible={!!photoView} transparent animationType="fade" onRequestClose={() => setPhotoView(null)}>
          <TouchableOpacity style={styles.photoBackdrop} activeOpacity={1} onPress={() => setPhotoView(null)}>
            {photoView && <Image source={photoView} style={styles.photoFull} resizeMode="contain" />}
            <Text style={styles.photoClose}>눌러서 닫기</Text>
          </TouchableOpacity>
        </Modal>
    </>
  );

  return (
    <>
      {!delegateOnly && (
        <View style={styles.tabs}>
          {(["inbox", "history"] as const).map((t) => (
            <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabBtnOn]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
                {t === "inbox" ? "승인 대기" : admin ? "휴가 내역" : "지점 휴가"}
                {t === "inbox" && total > 0 ? <Text style={styles.tabCount}> {total}</Text> : null}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      {/* 아직 안 보냈음을 알린다 — 「N초 뒤 보냅니다」(검증 B1-c) */}
      {pending && (
        <View style={styles.undo}>
          <Text style={styles.undoText} numberOfLines={2}>{pending.item.who}님 {nameOf(pending.item)} 승인 · <GraceLeft until={pending.until} />초 뒤 보냅니다</Text>
          <TouchableOpacity onPress={undo} style={styles.undoBtn} accessibilityLabel="승인 되돌리기 — 아직 보내지 않았습니다">
            <Text style={styles.undoBtnText}>되돌리기</Text>
          </TouchableOpacity>
        </View>
      )}
      {!pending && !!notice && (
        <View style={styles.undo}>
          <Text style={styles.undoText}>{notice}</Text>
        </View>
      )}
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 14, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {tab === "inbox" && (
          <>
            {failed && <Text style={styles.empty}>승인 목록을 불러오지 못했습니다. 아래로 당겨 다시 시도해 주세요.</Text>}
            {showFilter && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingBottom: 10 }}>
                {(["", "근무 변경", "휴가", "출퇴근 수정"] as const).map((g) => {
                  const n = g ? visible.filter((i) => GROUP_OF[i.kind] === g).length : total;
                  return (
                    <TouchableOpacity key={g || "all"} style={[styles.chip, filter === g && styles.chipOn]} onPress={() => setFilter(g)}>
                      <Text style={[styles.chipText, filter === g && styles.chipTextOn]}>{g || "전체"} {n}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            {!failed && total === 0 && (
              <View style={styles.emptyWrap}>
                <Ionicons name="checkmark-circle-outline" size={48} color="#cbd5e1" />
                <Text style={styles.empty}>승인 대기가 없습니다.</Text>
              </View>
            )}
            {shown.map((it) => (
              <TouchableOpacity key={it.key} style={styles.card} activeOpacity={0.8} onPress={() => setDetail(it)}>
                {head(it)}
                <Text style={styles.t2}>{it.title}</Text>
                {infoBox(it)}
                {buttons(it)}
              </TouchableOpacity>
            ))}
          </>
        )}

        {tab === "history" && !delegateOnly && (
          <>
            {historyFailed && <Text style={styles.empty}>휴가 내역을 불러오지 못했습니다. 아래로 당겨 다시 시도해 주세요.</Text>}
            {!historyFailed && hist.length === 0 && (
              <View style={styles.emptyWrap}>
                <Ionicons name="calendar-outline" size={48} color="#cbd5e1" />
                <Text style={styles.empty}>진행 중이거나 예정된 휴가가 없습니다.</Text>
              </View>
            )}
            {hist.length > 0 && (
              <View style={styles.lst}>
                {hist.map((r, i) => {
                  const approved = r.status === "APPROVED";
                  const s = ymd(r.startDate), e = ymd(r.endDate);
                  const nowOn = s <= today && today <= e;
                  const open = openHist === r.id;
                  const note = r.cancelBlock ? CANCEL_BLOCK_LABEL[r.cancelBlock] : undefined;
                  const steps = (r.approvalSteps as Step[]) || [];
                  const comments = steps.map((x) => cleanComment(x.comment)).filter(Boolean);
                  return (
                    <TouchableOpacity key={r.id} style={[styles.it, i > 0 && styles.itLine, nowOn && styles.itOn]} activeOpacity={0.7} onPress={() => setOpenHist(open ? null : r.id)}>
                      <View style={styles.itRow}>
                        <View style={styles.dy}>
                          <Text style={[styles.dyNum, isWeekend(s) && { color: C.weekend }]}>{fmtShort(s).split(" ")[0]}</Text>
                          <Text style={styles.dySub}>{s === e ? wd(s) : `${wd(s)}~${wd(e)}`}</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.itTitle} numberOfLines={1}>{r.user.name}{admin && r.user.branch ? ` (${r.user.branch})` : ""} · {LEAVE_TYPE_LABEL[r.type] || r.type}</Text>
                          <Text style={styles.itSub} numberOfLines={1}>
                            {s === e ? "" : `${fmtRange(s, e)} · `}{r.days}일{approved ? <Text>{" · "}<Text style={styles.okBlue}>승인</Text></Text> : null}
                          </Text>
                        </View>
                        {!approved ? <Pill text="승인 대기" tone="amb" /> : nowOn ? <Pill text="오늘" tone="ind" /> : null}
                      </View>
                      {open && (
                        <View style={styles.histMore}>
                          {steps.length > 0 && <Text style={styles.histLine}>결재 순서 · {chainText(steps)}</Text>}
                          {comments.map((c, k) => <Text key={k} style={styles.histLine}>의견 · {c}</Text>)}
                          {!!r.reason && <Text style={styles.histLine}>사유 · {r.reason}</Text>}
                          {!!r.pendingCancel && <Text style={styles.histLine}>취소 결재 진행 중</Text>}
                          {!approved && inboxIds.has(r.id) && (
                            <TouchableOpacity style={styles.linkBtn} onPress={() => setTab("inbox")}>
                              <Text style={styles.link}>승인 대기에서 보기 ›</Text>
                            </TouchableOpacity>
                          )}
                          {r.canCancel ? (
                            <TouchableOpacity style={styles.ghostBtn} disabled={processingId === r.id} onPress={() => cancel("leave", r.id, r.user.name, { approved, ownerId: r.userId })}>
                              {processingId === r.id ? <ActivityIndicator size="small" color={C.gray} /> : <Text style={styles.ghostText}>신청 취소</Text>}
                            </TouchableOpacity>
                          ) : note ? <Text style={styles.histNote}>{note}</Text> : null}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* 상세 — 결재 순서 · 첨부 · 사진 · 취소 */}
      <Modal visible={!!detail} transparent animationType="slide" onRequestClose={() => setDetail(null)}>
        <View style={styles.sheetBg}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setDetail(null)} />
          {detail && (
            <View style={styles.sheet}>
              <View style={styles.grab} />
              <ScrollView style={{ maxHeight: 460 }} contentContainerStyle={{ gap: 10 }}>
                {head(detail)}
                <Text style={styles.t2}>{detail.title}</Text>
                {infoBox(detail)}
                {!!detail.steps?.length && <Text style={styles.histLine}>결재 순서 · {chainText(detail.steps)}</Text>}
                {(detail.steps || []).map((x) => cleanComment(x.comment)).filter(Boolean).map((c, k) => <Text key={k} style={styles.histLine}>의견 · {c}</Text>)}
                {!!detail.attachment && (
                  <TouchableOpacity style={styles.linkBtn} onPress={() => Linking.openURL(fileUri(detail.attachment!.url))}>
                    <Ionicons name="document-attach-outline" size={16} color={C.ind} />
                    <Text style={styles.link} numberOfLines={1}>{detail.attachment.name}</Text>
                  </TouchableOpacity>
                )}
                {detail.hasPhoto && (
                  <TouchableOpacity style={styles.linkBtn} onPress={async () => setPhotoView(await attendance.attendanceRequestPhotoSource(detail.id))}>
                    <Ionicons name="image-outline" size={16} color={C.ind} />
                    <Text style={styles.link}>지점 사진 보기</Text>
                  </TouchableOpacity>
                )}
                {detail.canCancel && detail.cancelKind && (
                  <TouchableOpacity style={styles.ghostBtn} disabled={processingId === detail.id} onPress={() => cancel(detail.cancelKind!, detail.id, detail.who)}>
                    <Text style={styles.ghostText}>신청 취소 (반려와 달리 결재 기록에 남지 않음)</Text>
                  </TouchableOpacity>
                )}
              </ScrollView>
              {buttons(detail)}
            </View>
          )}
        </View>
        {/* 반려 · 사진 창은 상세 「안」에 — 형제로 두면 iOS 에서 상세 위로 안 올라온다(홈 공지 사진과 같은 처리) */}
        {!!detail && overlays}
      </Modal>

      {!detail && overlays}
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: C.bg },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: C.line },
  tabBtn: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 48, borderBottomWidth: 3, borderBottomColor: "transparent" },
  tabBtnOn: { borderBottomColor: C.ind },
  tabText: { fontSize: 15, color: C.muted, fontWeight: "700" },
  tabTextOn: { color: C.ind },
  tabCount: { color: C.amb },
  undo: { flexDirection: "row", alignItems: "center", backgroundColor: "#1e293b", marginHorizontal: 14, marginTop: 12, borderRadius: 12, paddingLeft: 14 },
  undoText: { flex: 1, color: "#fff", fontSize: 14, paddingVertical: 12 },
  undoBtn: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center" },
  undoBtnText: { color: "#a5b4fc", fontSize: 14, fontWeight: "700" },
  emptyWrap: { alignItems: "center", paddingTop: 70 },
  empty: { color: C.muted, fontSize: 14.5, marginTop: 12, textAlign: "center" },
  chip: { minHeight: 44, justifyContent: "center", borderWidth: 1, borderColor: C.line, backgroundColor: "#fff", borderRadius: 999, paddingHorizontal: 12 },
  chipOn: { backgroundColor: C.ind, borderColor: C.ind },
  chipText: { fontSize: 13, fontWeight: "700", color: C.gray },
  chipTextOn: { color: "#fff" },
  card: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 15, marginBottom: 12, gap: 8 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  who: { fontSize: 16, fontWeight: "700", color: C.ink, flexShrink: 0, maxWidth: "45%" },
  headSub: { fontSize: 13.5, color: C.sub, flexShrink: 1 },
  pill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 },
  pillText: { fontSize: 12.5, fontWeight: "700" },
  t2: { fontSize: 16, fontWeight: "800", color: C.ink, lineHeight: 23 },
  info: { backgroundColor: "#f8fafc", borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, gap: 3 },
  infoText: { fontSize: 13.5, color: "#334155", lineHeight: 19 },
  infoBold: { fontWeight: "700", color: C.ink },
  infoRed: { fontWeight: "700", color: C.red },
  btn2: { flexDirection: "row", gap: 8, marginTop: 2 },
  bNo: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1.5, borderColor: C.line, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  bNoText: { fontSize: 15, fontWeight: "700", color: "#334155" },
  bOk: { flex: 1, height: 46, borderRadius: 12, backgroundColor: C.ind, alignItems: "center", justifyContent: "center" },
  bOkText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  lst: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: C.line, overflow: "hidden" },
  it: { paddingHorizontal: 14, paddingVertical: 12, minHeight: 56, justifyContent: "center" },
  itLine: { borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  itOn: { backgroundColor: "#f7f8ff" },
  itRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  dy: { width: 48 },
  dyNum: { fontSize: 14, fontWeight: "700", color: "#334155" },
  dySub: { fontSize: 12, color: C.muted, marginTop: 1 },
  itTitle: { fontSize: 14.5, fontWeight: "700", color: C.ink },
  itSub: { fontSize: 13.5, color: C.sub, marginTop: 2 },
  okBlue: { color: C.blue, fontWeight: "700" },
  histMore: { marginTop: 10, marginLeft: 58, gap: 4 },
  histLine: { fontSize: 13.5, color: C.sub, lineHeight: 19 },
  histNote: { fontSize: 13, color: C.muted, marginTop: 4 },
  linkBtn: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44 },
  link: { fontSize: 14, fontWeight: "700", color: C.ind, flexShrink: 1 },
  ghostBtn: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: C.line, backgroundColor: "#fff", marginTop: 4 },
  ghostText: { fontSize: 13.5, color: C.gray, fontWeight: "700" },
  sheetBg: { flex: 1, backgroundColor: "rgba(15,23,42,0.35)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 30, gap: 12 },
  grab: { width: 40, height: 4, borderRadius: 99, backgroundColor: "#cbd5e1", alignSelf: "center" },
  modalBg: { flex: 1, backgroundColor: "rgba(15,23,42,0.4)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: "#fff", borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: "800", color: C.ink },
  modalSub: { fontSize: 13.5, color: C.sub, marginTop: 4, marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#d5dbe5", borderRadius: 10, padding: 12, fontSize: 14.5, minHeight: 90, textAlignVertical: "top", color: C.ink },
  modalBtns: { flexDirection: "row", gap: 8, marginTop: 16 },
  modalCancel: { flex: 1, height: 46, borderRadius: 12, backgroundColor: C.grayBg, alignItems: "center", justifyContent: "center" },
  modalCancelText: { fontSize: 15, color: "#334155", fontWeight: "700" },
  modalConfirm: { flex: 1, height: 46, borderRadius: 12, backgroundColor: C.ind, alignItems: "center", justifyContent: "center" },
  modalConfirmText: { fontSize: 15, color: "#fff", fontWeight: "700" },
  photoBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", alignItems: "center" },
  photoFull: { width: "100%", height: "80%" },
  photoClose: { color: "#fff", fontSize: 14, marginTop: 12 },
});

/** 홈 「승인 대기」 목록(2026-10-23 앱 7 · 시안 S2-1) — 승인 화면과 같은 카드 요약 한 줄. 전부 못 받으면 null */
export async function loadInboxPreview(admin: boolean): Promise<{ count: number; items: { key: string; who: string; group: string; summary: string }[] } | null> {
  const r = await Promise.allSettled([getScheduleApprovals(), getLeaveApprovals(), getLeaveCancelApprovals(), attendance.getAttendanceRequestInbox()]);
  if (r.every((x) => x.status === "rejected")) return null;
  const v = <T,>(x: PromiseSettledResult<T[]>) => (x.status === "fulfilled" ? x.value : ([] as T[]));
  const items: Item[] = [
    ...v(r[0] as PromiseSettledResult<ScheduleInboxStep[]>).map(schedItem),
    ...v(r[1] as PromiseSettledResult<LeaveInboxStep[]>).map(leaveItem),
    ...v(r[2] as PromiseSettledResult<LeaveCancelInboxStep[]>).map(cancelItem),
    ...v(r[3] as PromiseSettledResult<attendance.AttendanceRequestRow[]>).map((x) => attItem(x, admin)),
  ].sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return { count: items.length, items: items.map((i) => ({ key: i.key, who: i.who, group: nameOf(i), summary: i.summary })) };
}
