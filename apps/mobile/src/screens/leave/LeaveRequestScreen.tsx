import React, { useCallback, useEffect, useRef, useState } from "react";
import { cancelLeave, requestLeaveCancel, withdrawLeaveCancel, getMyLedger, getYearBalance } from "../../services/approvals";
import type { MyLedger } from "../../services/approvals";
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
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "@react-navigation/elements";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import { LeaveType, LeaveRequest, LeaveBalance } from "@shiftee/api";
import * as api from "../../services/api";
import * as storage from "../../services/storage";
import { uploadFile, fileUri } from "../../services/work";
import DatePicker from "../../components/DatePicker";

const TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차",
  QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
  SICK: "병가", PERSONAL: "개인휴가", SPECIAL: "특별휴가",
  COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차",
  CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련",
  FAMILY_EVENT: "기타 경조사", BEREAVEMENT: "경조사", MATERNITY: "출산휴가",
  FAMILY_MARRIAGE: "결혼", FAMILY_BIRTH: "출산", FAMILY_BEREAVEMENT: "사망(조사)",
};

// 휴가 유형 — 3개 카테고리(탭) + 각 드롭다운
const CATEGORIES: { key: string; label: string; options: { value: LeaveType; label: string }[] }[] = [
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
    key: "FAMILY", label: "경조사", options: [
      { value: "FAMILY_MARRIAGE", label: "결혼" },
      { value: "FAMILY_BIRTH", label: "출산" },
      { value: "FAMILY_BEREAVEMENT", label: "사망(조사)" },
      { value: "FAMILY_EVENT", label: "기타 경조사" },
    ],
  },
  {
    key: "ETC", label: "기타", options: [
      { value: "SICK", label: "병가" },
      { value: "SPECIAL", label: "특별휴가" },
      { value: "COMPENSATORY", label: "대체휴무" },
      { value: "CIVIL_DEFENSE", label: "민방위" },
      { value: "RESERVE_FORCES", label: "예비군훈련" },
    ],
  },
];

// 하루짜리 유형(반차·반반차·민방위) — 시작일만 받고 종료일=시작일
const SINGLE_DAY = new Set<LeaveType>(["HALF_AM", "HALF_PM", "QUARTER_AM", "QUARTER_PM", "CIVIL_DEFENSE"]);

const STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: "대기중", color: "#f59e0b" },
  APPROVED: { label: "승인", color: "#10b981" },
  REJECTED: { label: "반려", color: "#ef4444" },
  CANCELLED: { label: "취소", color: "#9ca3af" },
};

export default function LeaveRequestScreen() {
  const headerHeight = useHeaderHeight();
  const [category, setCategory] = useState("ANNUAL");
  const [leaveType, setLeaveType] = useState<LeaveType>("ANNUAL");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [balance, setBalance] = useState<LeaveBalance | null>(null);
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
  const LEDGER_STATUS: Record<string, string> = { PENDING: "대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소", WAITING: "대기 전" };
  // 서버가 scope=self 로 잘라 주지만, 목록 범위 하나에만 기대지 않는다.
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const activeCategory = CATEGORIES.find((c) => c.key === category)!;
  const activeOption = activeCategory.options.find((o) => o.value === leaveType) ?? activeCategory.options[0];
  const isSingleDay = SINGLE_DAY.has(leaveType);
  const isCompensatory = leaveType === "COMPENSATORY";

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
    const cat = CATEGORIES.find((c) => c.key === key)!;
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
    getYearBalance(reqYear)
      .then((b) => { if (alive) setYearBal({ year: reqYear, remaining: b ? b.remaining : null }); })
      .catch(() => { if (alive) setYearBal(null); });
    return () => { alive = false; };
  }, [reqYear, kstYear]);

  const load = useCallback(async () => {
    try {
      const [b, r] = await Promise.all([api.getLeaveBalance(), api.getLeaveRequests()]);
      setBalance(b);
      setRequests(r);
    } catch (error) {
      console.error("❌ Failed to load leave:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    storage.getUser().then((u) => setMyId(u?.id || "")).catch(() => {});
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleSubmit = async () => {
    if (!startDate) {
      Alert.alert("오류", isSingleDay ? "날짜를 선택해주세요" : "시작일과 종료일을 입력해주세요");
      return;
    }
    if (!isSingleDay && !endDate) {
      Alert.alert("오류", "시작일과 종료일을 입력해주세요");
      return;
    }
    if (!reason.trim()) {
      Alert.alert("오류", "신청 사유를 입력해주세요");
      return;
    }
    if (isCompensatory && !attachmentUrl) {
      Alert.alert("오류", "대체휴무는 대체휴무 동의서 첨부가 필요합니다");
      return;
    }
    const finalEnd = isSingleDay ? startDate : endDate;

    setIsLoading(true);
    try {
      await api.createLeaveRequest({ type: leaveType, startDate, endDate: finalEnd, reason, attachmentUrl, attachmentName });
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
      setIsLoading(false);
    }
  };

  const fmtDate = (s: string) => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={headerHeight}
    >
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* 잔여 휴가 */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>잔여 연차</Text>
        <Text style={styles.balanceValue}>
          {balance ? `${balance.remaining}일` : "—"}
        </Text>
        {balance && (
          <Text style={styles.balanceSub}>
            총 {balance.total}일 중 {balance.used}일 사용
          </Text>
        )}
        <TouchableOpacity style={styles.ledgerBtn} onPress={() => openLedger(ledgerYear)}>
          <Text style={styles.ledgerBtnText}>연차 대장 보기 ›</Text>
        </TouchableOpacity>
      </View>

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
                  {ledger.balance
                    ? `총 ${ledger.balance.total}일 · 사용 ${ledger.balance.used}일 · 잔여 ${ledger.balance.remaining}일`
                    : "이 해의 연차 기록이 없습니다"}
                </Text>
                <Text style={[styles.ledgerBoxSub, ledger.summary.match === false && { color: "#dc2626" }]}>
                  승인된 연차 휴가 합계 {ledger.summary.approvedDeductibleDays}일 / 기록된 사용 {ledger.summary.balanceUsed ?? "-"}일
                  {ledger.summary.match === null ? "" : ledger.summary.match ? " · 일치" : " · 불일치(관리자에게 문의)"}
                </Text>
              </View>

              <Text style={styles.ledgerSection}>휴가 {ledger.entries.length}건</Text>
              {ledger.entries.length === 0 && <Text style={styles.ledgerEmpty}>이 해에 신청한 휴가가 없습니다.</Text>}
              {ledger.entries.map((e) => {
                const st = STATUS[e.status] || STATUS.PENDING;
                return (
                  <View key={e.id} style={styles.ledgerItem}>
                    <View style={styles.histHeader}>
                      <Text style={styles.histType}>{TYPE_LABEL[e.type] || e.type} · {e.days}일</Text>
                      <View style={[styles.badge, { backgroundColor: st.color }]}>
                        <Text style={styles.badgeText}>{st.label}</Text>
                      </View>
                    </View>
                    <Text style={styles.histDate}>
                      {e.startDate}{e.startDate !== e.endDate ? ` ~ ${e.endDate}` : ""}{e.deductible ? "" : " · 연차 미차감"}
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

              <Text style={styles.ledgerSection}>잔여 조정 이력 {ledger.adjustments.length}건</Text>
              {ledger.adjustments.length === 0 && <Text style={styles.ledgerEmpty}>이 해에 잔여 조정 기록이 없습니다.</Text>}
              {ledger.adjustments.map((a, i) => (
                <Text key={i} style={styles.ledgerLine}>{kstStr(a.at)} · {a.actorName} · {a.detail ?? ""}</Text>
              ))}
            </ScrollView>
          ) : null}
        </View>
      </Modal>

      {/* 휴가 신청 폼 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>휴가 신청</Text>
        <Text style={styles.label}>휴가 유형</Text>

        {/* 카테고리 탭 */}
        <View style={styles.typeButtons}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat.key}
              style={[styles.typeButton, category === cat.key && styles.typeButtonActive]}
              onPress={() => pickCategory(cat.key)}
            >
              <Text style={[styles.typeButtonText, category === cat.key && styles.typeButtonTextActive]}>
                {cat.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* 세부 유형 드롭다운 */}
        <TouchableOpacity style={styles.dropdown} onPress={() => setDropdownOpen(true)} activeOpacity={0.7}>
          <Text style={styles.dropdownText}>{activeOption.label}</Text>
          <Ionicons name="chevron-down" size={18} color="#6b7280" />
        </TouchableOpacity>

        <Text style={styles.label}>{isSingleDay ? "날짜" : "시작일"}</Text>
        <DatePicker
          value={startDate}
          onChange={(d) => {
            setStartDate(d);
            if (endDate && endDate < d) setEndDate(""); // 종료일이 시작일보다 빠르면 초기화
          }}
          placeholder="날짜 선택"
          disabled={isLoading}
        />

        {!isSingleDay && (
          <>
            <Text style={styles.label}>종료일</Text>
            <DatePicker
              value={endDate}
              onChange={setEndDate}
              placeholder="날짜 선택"
              minDate={startDate || undefined}
              disabled={isLoading}
            />
          </>
        )}

        {yearBal && (
          <View style={styles.yearBalBox}>
            <Text style={styles.yearBalText}>
              {yearBal.year}년 잔여 연차 {yearBal.remaining === null ? "—" : `${yearBal.remaining}일`}
            </Text>
            <Text style={styles.yearBalSub}>{yearBal.year}년 휴가는 {yearBal.year}년 연차에서 차감됩니다</Text>
          </View>
        )}

        <Text style={styles.label}>신청 사유 *</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="신청 사유를 입력하세요 (필수)"
          value={reason}
          onChangeText={setReason}
          multiline
          editable={!isLoading}
        />

        {/* 첨부 (대체휴무는 동의서 필수) */}
        <Text style={styles.label}>
          첨부파일{isCompensatory ? " (대체휴무 동의서 필수)" : " (선택)"}
        </Text>
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

        <TouchableOpacity
          style={[styles.submitButton, isLoading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>신청하기</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* 신청 내역 */}
      <View style={styles.historySection}>
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
                  <View style={[styles.badge, { backgroundColor: st.color }]}>
                    <Text style={styles.badgeText}>{st.label}</Text>
                  </View>
                </View>
                <Text style={styles.histDate}>
                  {fmtDate(r.startDate)} ~ {fmtDate(r.endDate)}
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
            <Text style={styles.sheetTitle}>{activeCategory.label} 유형 선택</Text>
            {activeCategory.options.map((o) => {
              const selected = o.value === leaveType;
              return (
                <TouchableOpacity
                  key={o.value}
                  style={styles.sheetRow}
                  onPress={() => {
                    setLeaveType(o.value);
                    setDropdownOpen(false);
                  }}
                >
                  <Text style={[styles.sheetRowText, selected && styles.sheetRowTextActive]}>{o.label}</Text>
                  {selected && <Ionicons name="checkmark" size={20} color="#2563eb" />}
                </TouchableOpacity>
              );
            })}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  balanceCard: {
    backgroundColor: "#2563eb",
    margin: 16,
    marginBottom: 8,
    borderRadius: 12,
    padding: 20,
  },
  balanceLabel: { color: "#dbeafe", fontSize: 14 },
  balanceValue: { color: "#fff", fontSize: 32, fontWeight: "bold", marginTop: 4 },
  balanceSub: { color: "#dbeafe", fontSize: 13, marginTop: 4 },
  ledgerBtn: { marginTop: 10, alignSelf: "flex-start" },
  ledgerBtnText: { color: "#fff", fontSize: 13, fontWeight: "600", textDecorationLine: "underline" },
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
    borderRadius: 12,
    padding: 20,
    margin: 16,
    marginTop: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "bold", color: "#111827", marginBottom: 8 },
  label: { fontSize: 14, fontWeight: "600", color: "#1f2937", marginBottom: 8, marginTop: 16 },
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
    paddingVertical: 12,
    marginTop: 10,
  },
  dropdownText: { fontSize: 14, color: "#1f2937", fontWeight: "600" },
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
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
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
  sheetRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, paddingVertical: 14 },
  sheetRowText: { fontSize: 16, color: "#1f2937" },
  sheetRowTextActive: { color: "#2563eb", fontWeight: "700" },
});
