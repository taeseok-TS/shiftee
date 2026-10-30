import React, { useCallback, useEffect, useRef, useState } from "react";
import { LEAVE_LABELS } from "../../services/leaveLabels";
import { cancelLeave, requestLeaveCancel, withdrawLeaveCancel, getMyLedger, getYearBalance, getLeaveTypes, getMyLeaveBalance, getLeaveDaysPreview, getApprovalPreview, type LeaveTypeItem } from "../../services/approvals";
import { C, fmtRange } from "../../services/fmt";
import type { MyLedger, LeaveDaysPreview } from "../../services/approvals";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
  RefreshControl,
  Modal,
  Linking,
  KeyboardAvoidingView,
  } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "@react-navigation/elements";
import { useFocusEffect } from "@react-navigation/native";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { LeaveType, LeaveRequest } from "@shiftee/api";
import * as api from "../../services/api";
import * as storage from "../../services/storage";
import { uploadFile, fileUri, useUploadsTicketVersion } from "../../services/work";
import DatePicker from "../../components/DatePicker";

// 이름 — 기본값도 기준표(services/leaveLabels), 서버 labels 를 받으면 그걸로 덮는다
const TYPE_LABEL: Record<string, string> = { ...LEAVE_LABELS };   // 서버 기준표와 같은 이름(services/leaveLabels)

// 휴가 유형 — 3개 카테고리(탭) + 각 드롭다운. 서버 기준표(GET /leave/types)를 받으면 그걸로 만든다(아래 buildCategories).
// 이 목록은 받기 전·실패 때 쓰는 기본값 — 본부 답변 #19 표대로(병가·옛 경조 세부 유형 없음)
type LeaveOpt = { value: LeaveType; label: string; unit?: "FULL" | "HALF" | "QUARTER"; attachRequired?: string | null; notice?: string | null };
type Category = { key: string; label: string; options: LeaveOpt[] };
const FALLBACK_CATEGORIES: Category[] = [
  {
    key: "ANNUAL", label: "연차", options: [
      { value: "ANNUAL", label: "연차" },
      { value: "HALF_AM", label: "오전반차" },
      { value: "HALF_PM", label: "오후반차" },
      { value: "QUARTER_AM", label: "오전반반차" },
      { value: "QUARTER_PM", label: "오후반반차" },
    ],
  },
  {
    key: "FAMILY", label: "경조·보상·대체", options: [
      { value: "FAMILY_CONDOLENCE" as LeaveType, label: "경조휴가(조사)", attachRequired: "증빙 서류" },   // 2026-10-22 조사·경사로 나눔(서버 기준표와 같게)
      { value: "FAMILY_CELEBRATION" as LeaveType, label: "경조휴가(경사)", attachRequired: "증빙 서류" },
      { value: "COMP_LEAVE" as LeaveType, label: "보상휴가", attachRequired: "보상휴가제 동의서" },
      { value: "COMP_LEAVE_HALF" as LeaveType, label: "보상휴가(반차)", unit: "HALF", attachRequired: "보상휴가제 동의서" },
      { value: "COMPENSATORY", label: "대체휴일", attachRequired: "휴일대체 동의서" },
      { value: "COMPENSATORY_HALF", label: "대체휴일(반차)", unit: "HALF", attachRequired: "휴일대체 동의서" },
    ],
  },
  {
    key: "ETC", label: "기타", options: [
      { value: "PRENATAL_CHECKUP" as LeaveType, label: "태아검진휴가", unit: "HALF" },
      { value: "REWARD" as LeaveType, label: "포상휴가" },
      { value: "MATERNITY" as LeaveType, label: "출산휴가", attachRequired: "출산휴가 신청서·증명서" },
      { value: "SPOUSE_BIRTH" as LeaveType, label: "배우자출산휴가" },
      { value: "FAMILY_CARE" as LeaveType, label: "가족돌봄휴가" },
      { value: "CIVIL_DEFENSE", label: "민방위 휴가", unit: "HALF", attachRequired: "민방위 참여 증빙" },
      { value: "RESERVE_FORCES", label: "예비군 휴가", attachRequired: "예비군 훈련 참여 확인증" },
      { value: "OTHER_PAID" as LeaveType, label: "기타휴가(유급)" },
      { value: "OTHER_UNPAID" as LeaveType, label: "기타휴가(무급)" },
    ],
  },
];

// 서버 기준표 → 탭 3개(연차 / 경조·보상·대체 / 기타)
const TAB_OF: Record<string, string> = { 연차휴가: "ANNUAL", 경조휴가: "FAMILY", 보상휴가: "FAMILY", 대체휴일: "FAMILY", 보건휴가: "ETC", 기타휴가: "ETC" };
function buildCategories(types: LeaveTypeItem[]): Category[] {
  const out = FALLBACK_CATEGORIES.map((c) => ({ ...c, options: [] as LeaveOpt[] }));
  for (const t of types) {
    const cat = out.find((c) => c.key === (TAB_OF[t.group] ?? "ETC"));
    cat?.options.push({ value: t.code as LeaveType, label: t.label, unit: t.unit, attachRequired: t.attachRequired, notice: t.notice });
  }
  // 본부가 한 탭의 유형을 모두 숨기면(#216-1) 그 탭만 뺀다 — 기본 목록으로 되돌리면 숨긴 유형이 다시 보인다(485880f 검증 F5)
  const nonEmpty = out.filter((c) => c.options.length);
  return nonEmpty.length ? nonEmpty : FALLBACK_CATEGORIES;
}

// 하루짜리 유형(반차·반반차·4시간 휴가) — 시작일만 받고 종료일=시작일
const SINGLE_DAY = new Set<LeaveType>(["HALF_AM", "HALF_PM", "QUARTER_AM", "QUARTER_PM"]);

// 상태 알약 — 대기 = 주황, 승인 = 파랑, 반려 = 빨강, 취소 = 회색(초록 금지, 2026-10-23 ■4)
const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  PENDING: { label: "승인 대기", color: "#b45309", bg: "#fffbeb" },
  APPROVED: { label: "승인", color: "#1e40af", bg: "#dbeafe" },
  REJECTED: { label: "반려", color: "#be123c", bg: "#fff1f2" },
  CANCELLED: { label: "취소함", color: "#475569", bg: "#f1f5f9" },
};
// 연차에서 빠지는 유형 — 「연차 2일 사용 → 남은 연차 15일」(사유는 선택)
const ANNUAL_CODES = new Set(["ANNUAL", "HALF_AM", "HALF_PM", "QUARTER_AM", "QUARTER_PM"]);

export default function LeaveRequestScreen() {
  useUploadsTicketVersion(); // 첨부·계약서 티켓이 첫 렌더보다 늦게 와도 다시 그려지게(2026-10-06)
  const headerHeight = useHeaderHeight();
  const [category, setCategory] = useState("ANNUAL");
  const [CATEGORIES, setCategories] = useState<Category[]>(FALLBACK_CATEGORIES);
  useEffect(() => {
    getLeaveTypes().then((d) => {
      if (d.types.length) setCategories(buildCategories(d.types));
      Object.assign(TYPE_LABEL, d.labels);   // 기록 표시 이름도 기준표로
    }).catch(() => {});
  }, []);
  const [leaveType, setLeaveType] = useState<LeaveType>("ANNUAL");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // 빠르게 두 번 누르면 두 번 신청되던 것 — isLoading 은 다음 렌더에야 바뀌어서, 누르는 즉시 ref 로 막는다(끝나면 푼다)
  const submitBusyRef = useRef(false);
  // 결재 순서(신청 버튼 위, 2026-10-23 앱 5) — 신청할 때와 같은 서버 함수의 미리보기
  const [chain, setChain] = useState<string>("");
  useEffect(() => {
    getApprovalPreview("LEAVE").then((st) => {
      const name = (x: { label: string }) => (x.label === "관리자" ? "본부" : x.label === "소속 지점 원장" ? "원장님" : x.label);
      setChain(st.map(name).join(" → "));
    }).catch(() => {});
  }, []);
  const scrollRef = useRef<ScrollView>(null);
  const [histY, setHistY] = useState(0);

  const [balance, setBalance] = useState<{ total: number; used: number; remaining: number } | null>(null);
  // 잔여 숫자 숨김(2026-10-16 #219-1) — 서버가 balanceHidden 을 주면 숫자 자리에 「연차 정리 중」. 신청·잔여 초과 막기는 그대로
  const [balanceHidden, setBalanceHidden] = useState(false);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [cancelingId, setCancelingId] = useState("");
  // 연차 대장 — 본인 열람만(9/11 디렉터). 관리자 PDF·원장 열람은 웹에서 한다.
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [ledgerYear, setLedgerYear] = useState(() => new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear());
  const [ledger, setLedger] = useState<MyLedger | null>(null);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState("");
  // 연도를 빠르게 넘기면 늦게 온 앞 연도 응답이 덮어쓴다(9/11 검증 D-5) — 마지막 요청만 반영
  const ledgerSeq = useRef(0);
  const openLedger = async (year: number) => {
    const my = ++ledgerSeq.current;
    setLedgerOpen(true);
    setLedgerYear(year);
    setLedgerLoading(true);
    setLedgerError("");
    try {
      const d = await getMyLedger(year);
      if (my === ledgerSeq.current) setLedger(d);
    } catch (e: any) {
      if (my !== ledgerSeq.current) return;
      setLedger(null);
      setLedgerError(e?.response?.data?.error || "연차 대장을 불러오지 못했습니다.");
    } finally {
      if (my === ledgerSeq.current) setLedgerLoading(false);
    }
  };
  const kstStr = (v: string | null) =>
    v ? new Date(new Date(v).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "-";
  const LEDGER_STATUS: Record<string, string> = { PENDING: "대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소함", WAITING: "대기 전" };
  // 서버가 scope=self 로 잘라 주지만, 목록 범위 하나에만 기대지 않는다.
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // 유형은 드롭다운 하나(2026-10-23 앱 5) — 버튼 3개 + 드롭다운으로 두 번 고르던 것을 합쳤다. 묶음(연차 · 경조·보상·대체 · 기타)은 목록 안 제목으로
  const allOptions = CATEGORIES.flatMap((c) => c.options);
  const activeCategory = CATEGORIES.find((c) => c.options.some((o) => o.value === leaveType)) ?? CATEGORIES.find((c) => c.key === category) ?? CATEGORIES[0];
  const activeOption = allOptions.find((o) => o.value === leaveType) ?? activeCategory.options[0];
  const isSingleDay = SINGLE_DAY.has(leaveType) || (activeOption.value === leaveType && !!activeOption.unit && activeOption.unit !== "FULL");
  const attachRequired = activeOption.value === leaveType ? activeOption.attachRequired ?? null : null;   // 동의서·증빙 필수(기준표)
  // 서버 기준표가 늦게 와서 고른 유형이 목록에서 빠졌으면(옛 기본 목록의 값 등) 화면에 보이는 첫 항목으로 맞춘다 — 보이는 것과 보내는 것이 달랐다(검증 P1)
  useEffect(() => {
    if (activeOption.value !== leaveType) setLeaveType(activeOption.value);
  }, [activeOption.value, leaveType]);

  const doUpload = async (file: { uri: string; name: string; mimeType?: string | null }) => {
    setAttaching(true);
    try {
      const res = await uploadFile(file);
      setAttachmentUrl(res.fileUrl);
      setAttachmentName(res.fileName);
    } catch (e: any) {
      Alert.alert("첨부 실패", e?.response?.data?.error || e?.message || "파일 업로드 중 오류가 발생했습니다.");
    } finally {
      setAttaching(false);
    }
  };

  const pickImageAttach = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (result.canceled || !result.assets?.length) return;
    const a = result.assets[0];
    await doUpload({ uri: a.uri, name: a.fileName || `photo_${Date.now()}.jpg`, mimeType: a.mimeType || "image/jpeg" });
  };

  const pickFileAttach = async () => {
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.length) return;
    const a = result.assets[0];
    await doUpload({ uri: a.uri, name: a.name, mimeType: a.mimeType });
  };

  const pickCategory = (key: string) => {
    const cat = CATEGORIES.find((c) => c.key === key) ?? CATEGORIES[0];
    setCategory(key);
    setLeaveType(cat.options[0].value); // 카테고리 바꾸면 첫 항목으로
  };
  // 본인 휴가 신청 취소 — 대기 중인 것만(서버가 다시 확인).
  // 잘못 낸 신청을 반려로 처리하면 기록에 "반려당함"으로 남아 나중에 오해를 산다.
  const cancelMyLeave = (id: string) => {
    Alert.alert(
      "신청 취소",
      `이 휴가 신청을 취소할까요?\n\n취소하면 결재가 중단되고 기록에는 '취소'로 남습니다.`,
      [
        { text: "닫기", style: "cancel" },
        {
          text: "취소하기",
          style: "destructive",
          onPress: async () => {
            setCancelingId(id);
            try {
              await cancelLeave(id);
              await load();
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


  // 승인된 휴가의 **취소 결재** — 버튼으로 바로 취소하지 않고 관리자까지 결재받는다(디렉터 9/11).
  // 결재가 도는 동안 연차는 차감된 채이고, 최종 승인 순간 복구된다. 버튼 표시는 서버 판정(canRequestCancel).
  const requestCancel = (id: string) => {
    Alert.alert(
      "취소 결재 올리기",
      "이 휴가의 취소 결재를 올릴까요?\n\n관리자까지 승인되면 휴가가 취소되고 연차가 복구됩니다. 휴가 시작 전날까지만 올릴 수 있습니다.",
      [
        { text: "닫기", style: "cancel" },
        {
          text: "올리기",
          onPress: async () => {
            setCancelingId(id);
            try {
              await requestLeaveCancel(id);
              await load();
              Alert.alert("취소 결재를 올렸습니다", "결재가 끝나면 알림으로 알려드립니다.");
            } catch (e: any) {
              Alert.alert("요청 실패", e?.response?.data?.error || "처리 중 오류가 발생했습니다.");
            } finally {
              setCancelingId("");
            }
          },
        },
      ]
    );
  };

  const withdrawCancel = (cancelId: string, leaveId: string) => {
    Alert.alert("취소 요청 철회", "취소 요청을 철회할까요? 휴가는 그대로 유지됩니다.", [
      { text: "닫기", style: "cancel" },
      {
        text: "철회",
        style: "destructive",
        onPress: async () => {
          setCancelingId(leaveId);
          try {
            await withdrawLeaveCancel(cancelId);
            await load();
          } catch (e: any) {
            Alert.alert("철회 실패", e?.response?.data?.error || "처리 중 오류가 발생했습니다.");
          } finally {
            setCancelingId("");
          }
        },
      },
    ]);
  };

  // 내년 날짜를 고르면 그 해 잔여를 따로 보여준다(9/11 디렉터) — 휴가는 쓰는 해(시작일) 연차에서 차감된다.
  // 값은 서버 신청 검사와 같은 함수에서 온다. 날짜를 빨리 바꿔도 늦게 온 응답은 버린다.
  const kstYear = new Date(Date.now() + 9 * 3600 * 1000).getUTCFullYear();
  const reqYear = /^\d{4}-/.test(startDate) ? Number(startDate.slice(0, 4)) : 0;
  const [yearBal, setYearBal] = useState<{ year: number; remaining: number | null } | null>(null);
  useEffect(() => {
    if (reqYear <= kstYear) { setYearBal(null); return; }
    let alive = true;
    getYearBalance(reqYear, leaveType)
      // 연차 미차감 유형(경조사·대체휴무 등)은 띄우지 않는다 — 판정은 서버(9/11 검증 E1)
      .then((r) => { if (alive) setYearBal(r.deductible && !r.hidden ? { year: reqYear, remaining: r.balance ? r.balance.remaining : null } : null); })
      .catch(() => { if (alive) setYearBal(null); });
    return () => { alive = false; };
  }, [reqYear, kstYear, leaveType]);

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([getMyLeaveBalance(), api.getLeaveRequests()]);
      setBalance(b.balance);
      setBalanceHidden(b.hidden);
      setRequests(r);
    } catch (error) {
      console.error("❌ Failed to load leave:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // 하단 탭이 됐다(2026-10-07 #17) — 탭은 한 번 뜨면 남아 있어서, 들어올 때마다 다시 불러와야
  // 승인 결과·잔여 연차가 최신이 된다(쓰다 만 입력값은 그대로 둔다)
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    storage.getUser().then((u) => setMyId(u?.id || "")).catch(() => {});
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  // 신청 일수 미리보기(2026-10-16 #219-10·11·12) — 서버가 신청 검사와 같은 함수(근무일정·공휴일 반영, 잔여 초과)로 센 값.
  // 날짜를 바꿀 때마다 0.3초 뒤 부르고, 늦게 온 앞 응답은 버린다. 실패하면 막지 않는다(신청 때 서버가 다시 본다)
  const previewEnd = isSingleDay ? startDate : endDate;
  const [preview, setPreview] = useState<LeaveDaysPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    setPreview(null);
    if (!startDate || !previewEnd || previewEnd < startDate) { setPreviewing(false); return; }
    let alive = true;
    setPreviewing(true);
    const t = setTimeout(() => {
      getLeaveDaysPreview(leaveType, startDate, previewEnd)
        .then((d) => { if (alive) setPreview(d); })
        .catch(() => { if (alive) setPreview(null); })
        .finally(() => { if (alive) setPreviewing(false); });
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [leaveType, startDate, previewEnd]);
  const previewBlocked = !!preview?.blocked;

  const isAnnual = ANNUAL_CODES.has(leaveType);
  const reasonRequired = !!attachRequired;   // 증빙이 필요한 휴가만 사유 필수(서버 규칙과 같다) — 연차는 선택
  const handleSubmit = async () => {
    if (!startDate) {
      Alert.alert("오류", isSingleDay ? "날짜를 선택해주세요" : "시작일과 종료일을 입력해주세요");
      return;
    }
    if (!isSingleDay && !endDate) {
      Alert.alert("오류", "시작일과 종료일을 입력해주세요");
      return;
    }
    if (reasonRequired && !reason.trim()) {
      Alert.alert("사유를 적어 주세요", `${activeOption.label}은(는) 사유가 필요합니다`);
      return;
    }
    if (attachRequired && !attachmentUrl) {
      Alert.alert("오류", `${activeOption.label}은(는) ${attachRequired} 첨부가 필요합니다`);
      return;
    }
    if (preview?.blocked) {
      Alert.alert("신청할 수 없습니다", preview.reason || "신청할 수 없는 기간입니다.");
      return;
    }
    const finalEnd = isSingleDay ? startDate : endDate;

    if (submitBusyRef.current) return;
    submitBusyRef.current = true;
    setIsLoading(true);
    try {
      await api.createLeaveRequest({ type: leaveType, startDate, endDate: finalEnd, reason: reason.trim() || null, attachmentUrl, attachmentName });
      Alert.alert("성공", "휴가 신청이 완료되었습니다");
      pickCategory("ANNUAL");
      setStartDate("");
      setEndDate("");
      setReason("");
      setAttachmentUrl(null);
      setAttachmentName(null);
      load(); // 잔여/내역 갱신
    } catch (error: any) {
      Alert.alert("오류", error.response?.data?.error || "휴가 신청 중 오류가 발생했습니다");
    } finally {
      submitBusyRef.current = false;
      setIsLoading(false);
    }
  };

  // 신청 일수 → 「연차 2일 사용 → 남은 연차 15일」(잔여 숨김이면 일수만). 결재 대기분은 서버가 빼고 준다(available)
  const calcText = (() => {
    if (!preview || preview.days <= 0) return "";
    const d = preview.days;
    if (isAnnual) {
      // 기간이 해를 넘거나, 남은 연차 기준(limit)이 올해 것이 아니면 일수만 — 올해 남은 연차에서 빼 보이면 틀린 숫자가 된다
      const lim = preview.limit?.kind === "annual" ? preview.limit : null;
      const crossYear = startDate.slice(0, 4) !== previewEnd.slice(0, 4);
      const limYear = lim?.year ?? Number(startDate.slice(0, 4));
      if (crossYear || limYear !== new Date().getFullYear()) return `연차 ${d}일 사용`;
      const avail = lim ? lim.available : null;
      const base = avail ?? (balanceHidden || !balance ? null : balance.remaining);
      return base == null ? `연차 ${d}일 사용` : `연차 ${d}일 사용 → 남은 연차 ${Math.round((base - d) * 10) / 10}일`;
    }
    if (preview.limit?.kind === "grant" && preview.limit.available != null) return `${activeOption.label} ${d}일 사용 → 남은 ${preview.limit.group ?? ""} ${Math.round((preview.limit.available - d) * 10) / 10}일`.replace("  ", " ");
    return `${activeOption.label} ${d}일`;
  })();
  const pendingCount = requests.filter((r) => r.status === "PENDING").length;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* 잔여 휴가 */}
      <View style={styles.balanceCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.balanceLabel}>남은 연차</Text>
          <Text style={styles.balanceValue}>
            {balanceHidden ? "연차 정리 중" : balance ? <>{balance.remaining}<Text style={styles.balanceUnit}>일</Text></> : "—"}
          </Text>
          {balanceHidden && <Text style={styles.balanceSub}>시프티 사용 내역을 옮기는 중이라 숫자는 잠시 보이지 않습니다. 휴가 신청은 그대로 할 수 있습니다.</Text>}
          {!balanceHidden && balance && <Text style={styles.balanceSub}>총 {balance.total}일 중 {balance.used}일 사용</Text>}
        </View>
        <TouchableOpacity style={styles.ledgerBtn} onPress={() => openLedger(ledgerYear)}>
          <Text style={styles.ledgerBtnText}>연차 대장 ›</Text>
        </TouchableOpacity>
      </View>

      {/* 내 신청 — 누르면 아래 신청 내역으로 */}
      <TouchableOpacity style={styles.mineCard} activeOpacity={0.7} onPress={() => scrollRef.current?.scrollTo({ y: histY, animated: true })}>
        <View style={{ flex: 1 }}>
          <Text style={styles.mineTitle}>내 신청</Text>
          <Text style={styles.mineSub}>{requests.length}건 · {pendingCount ? "" : "대기 없음"}</Text>
        </View>
        {pendingCount > 0 && <View style={[styles.badge, { backgroundColor: STATUS.PENDING.bg, marginRight: 8 }]}><Text style={[styles.badgeText, { color: STATUS.PENDING.color }]}>승인 대기 {pendingCount}</Text></View>}
        <Text style={styles.linkText}>보기 ›</Text>
      </TouchableOpacity>

      {/* 연차 대장 — iOS 는 시트로 띄운다(전체 화면이면 상태바에 닫기 버튼이 가린다 — 9/5 반려 창 사고) */}
      <Modal visible={ledgerOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLedgerOpen(false)}>
        <View style={styles.ledgerWrap}>
          <View style={styles.ledgerHead}>
            <TouchableOpacity style={styles.ledgerNav} onPress={() => openLedger(ledgerYear - 1)}>
              <Ionicons name="chevron-back" size={20} color="#374151" />
            </TouchableOpacity>
            <Text style={styles.ledgerTitle}>{ledgerYear}년 연차 대장</Text>
            <TouchableOpacity style={styles.ledgerNav} onPress={() => openLedger(ledgerYear + 1)}>
              <Ionicons name="chevron-forward" size={20} color="#374151" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.ledgerClose} onPress={() => setLedgerOpen(false)}>
              <Ionicons name="close" size={24} color="#374151" />
            </TouchableOpacity>
          </View>
          {ledgerLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} color="#2563eb" />
          ) : ledgerError ? (
            <Text style={styles.ledgerEmpty}>{ledgerError}</Text>
          ) : ledger ? (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              <View style={styles.ledgerBox}>
                <Text style={styles.ledgerBoxLabel}>연차 (휴가를 쓰는 해 기준)</Text>
                <Text style={styles.ledgerBoxValue}>
                  {ledger.balanceHidden
                    ? "연차 정리 중"
                    : ledger.balance
                    ? `총 ${ledger.balance.total}일 · 사용 ${ledger.balance.used}일 · 잔여 ${ledger.balance.remaining}일`
                    : "이 해의 연차 기록이 없습니다"}
                </Text>
                {!ledger.balanceHidden && (
                  <Text style={[styles.ledgerBoxSub, ledger.summary.match === false && { color: "#dc2626" }]}>
                    승인된 연차 휴가 합계 {ledger.summary.approvedDeductibleDays}일 / 기록된 사용 {ledger.summary.balanceUsed ?? "-"}일
                    {ledger.summary.match === null ? "" : ledger.summary.match ? " · 일치" : " · 불일치(관리자에게 문의)"}
                  </Text>
                )}
              </View>

              <Text style={styles.ledgerSection}>휴가 {ledger.entries.length}건</Text>
              {ledger.entries.length === 0 && <Text style={styles.ledgerEmpty}>이 해에 신청한 휴가가 없습니다.</Text>}
              {ledger.entries.map((e) => {
                const st = STATUS[e.status] || STATUS.PENDING;
                return (
                  <View key={e.id} style={styles.ledgerItem}>
                    <View style={styles.histHeader}>
                      <Text style={styles.histType}>{TYPE_LABEL[e.type] || e.type} · {e.days}일</Text>
                      <View style={[styles.badge, { backgroundColor: st.bg }]}>
                        <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.histDate}>
                      {fmtRange(e.startDate, e.endDate)}{e.deductible ? "" : " · 연차 미차감"}
                    </Text>
                    <Text style={styles.ledgerLine}>신청 {kstStr(e.createdAt)}{e.reason ? ` · ${e.reason}` : ""}</Text>
                    {!!e.rejectedReason && <Text style={[styles.ledgerLine, { color: "#dc2626" }]}>반려 사유: {e.rejectedReason}</Text>}
                    {e.steps.map((s2) => (
                      <Text key={`s${s2.order}`} style={styles.ledgerLine}>
                        결재 {s2.order}. {s2.approverName ?? (s2.role === "ADMIN" ? "관리자" : "원장")} — {LEDGER_STATUS[s2.status] ?? s2.status}
                        {s2.decidedAt ? ` ${kstStr(s2.decidedAt)}` : ""}
                      </Text>
                    ))}
                    {e.cancelRequests.map((c) => (
                      <Text key={c.id} style={[styles.ledgerLine, { color: "#b45309" }]}>
                        취소 요청 {kstStr(c.createdAt)} — {LEDGER_STATUS[c.status] ?? c.status}{c.rejectedReason ? ` · ${c.rejectedReason}` : ""}
                      </Text>
                    ))}
                  </View>
                );
              })}

              {/* 잔여 조정 이력은 숫자(「총 15→…일」)라 숨김일 때 서버가 빼고 보낸다 — 칸도 그리지 않는다(#219-1) */}
              {!ledger.balanceHidden && (
                <>
                  <Text style={styles.ledgerSection}>잔여 조정 이력 {ledger.adjustments.length}건</Text>
                  {ledger.adjustments.length === 0 && <Text style={styles.ledgerEmpty}>이 해에 잔여 조정 기록이 없습니다.</Text>}
                  {ledger.adjustments.map((a, i) => (
                    <Text key={i} style={styles.ledgerLine}>{kstStr(a.at)} · {a.actorName} · {a.detail ?? ""}</Text>
                  ))}
                </>
              )}
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      {/* 휴가 신청 폼 */}
      <View style={styles.card}>
        <Text style={[styles.label, { marginTop: 0 }]}>종류</Text>
        {/* 유형 드롭다운 하나 — 누르면 전 유형 목록(묶음 제목 포함) */}
        <TouchableOpacity style={styles.dropdown} onPress={() => setDropdownOpen(true)} activeOpacity={0.7} accessibilityLabel="휴가 종류 고르기">
          <Text style={styles.dropdownText}>{activeOption.label}</Text>
          <Ionicons name="chevron-down" size={18} color="#64748b" />
        </TouchableOpacity>

        <Text style={styles.label}>날짜</Text>
        <View style={styles.dateRow}>
          <View style={{ flex: 1 }}>
            <DatePicker
              value={startDate}
              onChange={(d) => {
                setStartDate(d);
                if (endDate && endDate < d) setEndDate(""); // 종료일이 시작일보다 빠르면 초기화
              }}
              placeholder={isSingleDay ? "날짜 선택" : "시작일"}
              disabled={isLoading}
            />
          </View>
          {!isSingleDay && (
            <>
              <Text style={styles.dateTilde}>~</Text>
              <View style={{ flex: 1 }}>
                <DatePicker
                  value={endDate}
                  onChange={setEndDate}
                  placeholder="종료일"
                  minDate={startDate || undefined}
                  disabled={isLoading}
                />
              </View>
            </>
          )}
        </View>

        {yearBal && (
          <View style={styles.yearBalBox}>
            <Text style={styles.yearBalText}>
              {yearBal.year}년 잔여 연차 {yearBal.remaining === null ? "—" : `${yearBal.remaining}일`}
            </Text>
            <Text style={styles.yearBalSub}>{yearBal.year}년 휴가는 {yearBal.year}년 연차에서 차감됩니다</Text>
          </View>
        )}

        {/* 신청 일수 — 서버 미리보기 값(근무일정·공휴일 반영). 막히면 이유를 보이고 신청 버튼을 막는다(#219-10·11) */}
        {previewing && <Text style={styles.previewMuted}>며칠 빠지는지 세는 중…</Text>}
        {!!calcText && !previewBlocked && (
          <View style={styles.calc}>
            <Text style={styles.calcText}>{calcText}</Text>
            {!!preview?.limit?.pending && <Text style={styles.calcSub}>결재 대기 {preview.limit.pending}일을 뺀 숫자입니다</Text>}
          </View>
        )}
        {previewBlocked && (
          <View style={styles.previewBlocked}>
            <Text style={styles.previewBlockedText}>{preview?.reason}</Text>
          </View>
        )}

        <Text style={styles.label}>사유 <Text style={styles.labelSub}>{reasonRequired ? "(필수)" : isAnnual ? "(연차는 선택)" : "(선택)"}</Text></Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder={reasonRequired ? "사유를 적어 주세요" : "적지 않아도 됩니다"}
          placeholderTextColor="#94a3b8"
          value={reason}
          onChangeText={setReason}
          multiline
          editable={!isLoading}
        />

        {/* 첨부 — 동의서·증빙 필수 유형은 기준표(attachRequired)대로 */}
        <Text style={styles.label}>
          첨부파일{attachRequired ? ` (${attachRequired} 필수)` : " (선택)"}
        </Text>
        {!!activeOption.notice && activeOption.value === leaveType && <Text style={{ fontSize: 12, color: "#6b7280", marginBottom: 6 }}>{activeOption.notice}</Text>}
        {attachmentUrl ? (
          <View style={styles.attachRow}>
            <Ionicons name="document-attach-outline" size={18} color="#2563eb" />
            <Text style={styles.attachName} numberOfLines={1}>{attachmentName}</Text>
            <TouchableOpacity onPress={() => { setAttachmentUrl(null); setAttachmentName(null); }}>
              <Ionicons name="close-circle" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.attachButtons}>
            <TouchableOpacity style={styles.attachBtn} onPress={pickImageAttach} disabled={attaching}>
              <Ionicons name="image-outline" size={18} color="#2563eb" />
              <Text style={styles.attachBtnText}>사진</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.attachBtn} onPress={pickFileAttach} disabled={attaching}>
              <Ionicons name="document-outline" size={18} color="#2563eb" />
              <Text style={styles.attachBtnText}>파일</Text>
            </TouchableOpacity>
            {attaching && <ActivityIndicator color="#2563eb" style={{ marginLeft: 8 }} />}
          </View>
        )}

      </View>

      {/* 신청 내역 */}
      <View style={styles.historySection} onLayout={(e) => setHistY(e.nativeEvent.layout.y)}>
        <Text style={styles.cardTitle}>신청 내역</Text>
        {loading ? (
          <ActivityIndicator color="#2563eb" style={{ marginTop: 16 }} />
        ) : requests.length === 0 ? (
          <Text style={styles.empty}>신청 내역이 없습니다.</Text>
        ) : (
          requests.map((r) => {
            const st = STATUS[r.status] || STATUS.PENDING;
            return (
              <View key={r.id} style={styles.histItem}>
                <View style={styles.histHeader}>
                  <Text style={styles.histType}>
                    {TYPE_LABEL[r.type] || r.type} · {r.days}일
                  </Text>
                  <View style={[styles.badge, { backgroundColor: st.bg }]}>
                    <Text style={[styles.badgeText, { color: st.color }]}>{st.label}</Text>
                  </View>
                </View>
                <Text style={styles.histDate}>
                  {fmtRange(r.startDate, r.endDate)}
                </Text>
                {r.reason ? <Text style={styles.histReason}>{r.reason}</Text> : null}
                {r.attachmentUrl ? (
                  <TouchableOpacity onPress={() => Linking.openURL(fileUri(r.attachmentUrl))} style={styles.attachRow}>
                    <Ionicons name="document-attach-outline" size={16} color="#2563eb" />
                    <Text style={styles.attachName} numberOfLines={1}>{r.attachmentName || "첨부 보기"}</Text>
                  </TouchableOpacity>
                ) : null}
                {r.status === "REJECTED" && r.rejectedReason ? (
                  <Text style={styles.histRejected}>반려 사유: {r.rejectedReason}</Text>
                ) : null}
                {/* 대기 중인 것만 거둔다. 반려와 다르다 — 반려는 결재 결과로 기록에 남고,
                    취소는 신청 자체를 거둔다(근무일정 신청과 같은 규칙). */}
                {/* 서버 판정(canCancel) — 대기 중 + 종료일이 오늘 이후(지난 휴가 아님). 본인 확인은 목록 범위에만 기대지 않으려고 덧댄다 */}
                {(r as { canCancel?: boolean }).canCancel && (!myId || r.userId === myId) && (
                  <TouchableOpacity
                    style={styles.histCancelBtn}
                    disabled={cancelingId === r.id}
                    onPress={() => cancelMyLeave(r.id)}
                  >
                    {cancelingId === r.id
                      ? <ActivityIndicator size="small" color="#6b7280" />
                      : <Text style={styles.histCancelText}>신청 취소</Text>}
                  </TouchableOpacity>
                )}
                {/* 원장이 승인해 본부 결재만 남은 건 — 취소 버튼 대신 이유를 보여 준다(2026-10-06) */}
                {(r as { cancelBlock?: string | null }).cancelBlock === "IN_REVIEW" && (!myId || r.userId === myId) && (
                  <Text style={[styles.histRejected, { color: "#6b7280" }]}>원장이 승인한 휴가라 바로 취소할 수 없어요. 취소가 필요하면 원장·본부에 요청해 주세요.</Text>
                )}
                {(r as { canRequestCancel?: boolean }).canRequestCancel && (
                  <TouchableOpacity
                    style={styles.histCancelBtn}
                    disabled={cancelingId === r.id}
                    onPress={() => requestCancel(r.id)}
                  >
                    {cancelingId === r.id
                      ? <ActivityIndicator size="small" color="#6b7280" />
                      : <Text style={styles.histCancelText}>취소 요청</Text>}
                  </TouchableOpacity>
                )}
                {(() => {
                  const pc = (r as { pendingCancel?: { id: string; mine: boolean } | null }).pendingCancel;
                  if (!pc) return null;
                  return (
                    <View style={styles.pendingCancelRow}>
                      <Text style={styles.pendingCancelText}>취소 결재 중 — 승인되면 연차가 복구됩니다</Text>
                      {pc.mine && (
                        <TouchableOpacity disabled={cancelingId === r.id} onPress={() => withdrawCancel(pc.id, r.id)}>
                          <Text style={styles.withdrawText}>철회</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })()}
              </View>
            );
          })
        )}
      </View>

      {/* 세부 유형 선택 모달 */}
      <Modal visible={dropdownOpen} transparent animationType="fade" onRequestClose={() => setDropdownOpen(false)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setDropdownOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
            <ScrollView style={{ maxHeight: 520 }}>
              {CATEGORIES.map((cat) => (
                <View key={cat.key}>
                  <Text style={styles.sheetTitle}>{cat.label}</Text>
                  {cat.options.map((o) => {
                    const selected = o.value === leaveType;
                    return (
                      <TouchableOpacity
                        key={o.value}
                        style={styles.sheetRow}
                        onPress={() => {
                          setCategory(cat.key);
                          setLeaveType(o.value);
                          setDropdownOpen(false);
                        }}
                      >
                        <Text style={[styles.sheetRowText, selected && styles.sheetRowTextActive]}>{o.label}</Text>
                        {selected && <Ionicons name="checkmark" size={20} color="#4f46e5" />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
    <View style={styles.dock}>
      {!!chain && <Text style={styles.dockLine}>승인 · {chain}</Text>}
      <TouchableOpacity
        style={[styles.submitButton, (isLoading || previewBlocked) && styles.buttonDisabled]}
        onPress={handleSubmit}
        disabled={isLoading || previewBlocked}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.submitButtonText}>신청하기</Text>
        )}
      </TouchableOpacity>
    </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  // 잔여 연차 판 — 진한 파랑 → 연한 인디고(2026-10-23 앱 5)
  balanceCard: {
    backgroundColor: C.indBg,
    borderWidth: 1,
    borderColor: "#dfe5ff",
    margin: 14,
    marginBottom: 8,
    borderRadius: 16,
    padding: 15,
    flexDirection: "row",
    alignItems: "center",
  },
  balanceLabel: { color: C.sub, fontSize: 13.5, fontWeight: "600" },
  balanceValue: { color: C.ink, fontSize: 26, fontWeight: "800", marginTop: 2 },
  balanceUnit: { fontSize: 15, fontWeight: "700" },
  balanceSub: { color: C.sub, fontSize: 13, marginTop: 4 },
  ledgerBtn: { minHeight: 44, justifyContent: "center", paddingLeft: 10 },
  ledgerBtnText: { color: C.ind, fontSize: 13.5, fontWeight: "700" },
  mineCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#fff", borderWidth: 1, borderColor: C.line, borderRadius: 16, marginHorizontal: 14, marginBottom: 8, paddingHorizontal: 15, paddingVertical: 12, minHeight: 56 },
  mineTitle: { fontSize: 15, fontWeight: "700", color: C.ink },
  mineSub: { fontSize: 13.5, color: C.sub, marginTop: 2 },
  linkText: { fontSize: 13.5, fontWeight: "700", color: C.ind },
  labelSub: { fontSize: 12.5, fontWeight: "500", color: C.muted },
  dateRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dateTilde: { fontSize: 15, color: "#94a3b8" },
  calc: { marginTop: 12, backgroundColor: C.indBg, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11 },
  calcText: { fontSize: 15, fontWeight: "700", color: C.indInk },
  calcSub: { fontSize: 12.5, color: C.sub, marginTop: 3 },
  dock: { backgroundColor: "#fff", borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  dockLine: { textAlign: "center", fontSize: 13.5, color: C.sub, marginBottom: 8 },
  ledgerWrap: { flex: 1, backgroundColor: "#f3f4f6" },
  ledgerHead: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingTop: 16, paddingBottom: 12, backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  ledgerNav: { padding: 6 },
  ledgerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "bold", color: "#111827" },
  ledgerClose: { padding: 6, marginLeft: 4 },
  ledgerBox: { backgroundColor: "#fff", borderRadius: 10, padding: 14 },
  ledgerBoxLabel: { fontSize: 12, color: "#6b7280" },
  ledgerBoxValue: { fontSize: 15, fontWeight: "600", color: "#111827", marginTop: 4 },
  ledgerBoxSub: { fontSize: 12, color: "#6b7280", marginTop: 6 },
  ledgerSection: { fontSize: 14, fontWeight: "bold", color: "#374151", marginTop: 18, marginBottom: 6 },
  ledgerItem: { backgroundColor: "#fff", borderRadius: 10, padding: 12, marginTop: 8 },
  ledgerLine: { fontSize: 12, color: "#4b5563", marginTop: 3 },
  ledgerEmpty: { fontSize: 13, color: "#9ca3af", textAlign: "center", marginTop: 12 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.line,
    padding: 15,
    margin: 14,
    marginTop: 4,
  },
  cardTitle: { fontSize: 16, fontWeight: "bold", color: "#111827", marginBottom: 8 },
  label: { fontSize: 14, fontWeight: "600", color: "#1f2937", marginBottom: 8, marginTop: 16 },
  previewMuted: { marginTop: 12, fontSize: 13, color: "#9ca3af" },
  previewBox: { marginTop: 12, flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#f3f4f6", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  previewLabel: { fontSize: 13, color: "#4b5563", flexShrink: 1 },
  previewValue: { fontSize: 15, fontWeight: "700", color: "#111827", marginLeft: 8 },
  previewBlocked: { marginTop: 12, backgroundColor: "#fef2f2", borderColor: "#fecaca", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  previewBlockedText: { fontSize: 13, color: "#b91c1c" },
  yearBalBox: { marginTop: 12, backgroundColor: "#fffbeb", borderColor: "#fde68a", borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  yearBalText: { fontSize: 14, fontWeight: "700", color: "#92400e" },
  yearBalSub: { fontSize: 12, color: "#b45309", marginTop: 2 },
  typeButtons: { flexDirection: "row", gap: 8 },
  typeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    alignItems: "center",
  },
  typeButtonActive: { backgroundColor: "#2563eb", borderColor: "#2563eb" },
  typeButtonText: { fontSize: 14, color: "#6b7280" },
  typeButtonTextActive: { color: "#fff", fontWeight: "600" },
  dropdown: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    minHeight: 48,
  },
  dropdownText: { fontSize: 15, color: "#0f172a", fontWeight: "700" },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#1f2937",
    marginBottom: 12,
  },
  textArea: { minHeight: 80, textAlignVertical: "top" },
  attachButtons: { flexDirection: "row", alignItems: "center", gap: 8 },
  attachBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
  },
  attachBtnText: { fontSize: 14, color: "#2563eb", fontWeight: "600" },
  attachRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#bfdbfe",
    backgroundColor: "#eff6ff",
    borderRadius: 8,
  },
  attachName: { flex: 1, fontSize: 13, color: "#1f2937" },
  submitButton: {
    backgroundColor: C.ind,
    height: 54,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontSize: 17, fontWeight: "800" },
  historySection: { paddingHorizontal: 16, paddingBottom: 24 },
  empty: { color: "#9ca3af", fontSize: 14, paddingVertical: 12 },
  histItem: { backgroundColor: "#fff", borderRadius: 10, padding: 14, marginTop: 8 },
  histHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  histType: { fontSize: 15, fontWeight: "600", color: "#111827" },
  histDate: { fontSize: 13, color: "#4b5563", marginTop: 6 },
  histReason: { fontSize: 13, color: "#6b7280", marginTop: 4 },
  histRejected: { fontSize: 13, color: "#ef4444", marginTop: 4 },
  histCancelBtn: { alignSelf: "flex-start", marginTop: 8, paddingVertical: 6, paddingHorizontal: 12,
                   borderRadius: 6, borderWidth: 1, borderColor: "#d1d5db", backgroundColor: "#fff" },
  histCancelText: { fontSize: 12, color: "#6b7280", fontWeight: "600" },
  pendingCancelRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
  pendingCancelText: { fontSize: 12, color: "#b45309", flexShrink: 1 },
  withdrawText: { fontSize: 12, color: "#6b7280", textDecorationLine: "underline" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  // 드롭다운 모달
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  sheet: { backgroundColor: "#fff", borderRadius: 14, padding: 12 },
  sheetTitle: { fontSize: 14, fontWeight: "700", color: "#6b7280", paddingHorizontal: 8, paddingVertical: 10 },
  sheetRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, minHeight: 48 },
  sheetRowText: { fontSize: 16, color: "#1f2937" },
  sheetRowTextActive: { color: "#4f46e5", fontWeight: "700" },
});
