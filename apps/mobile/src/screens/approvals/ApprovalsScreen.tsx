import React, { useCallback, useEffect, useState } from "react";
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fileUri } from "../../services/work";
import * as storage from "../../services/storage";
import {
  getLeaveApprovals,
  getScheduleApprovals,
  decideLeave,
  decideSchedule,
  cancelLeave,
  cancelSchedule,
  stepLabel,
  getTeamLeaves,
  getLeaveCancelApprovals,
  decideLeaveCancel,
  LeaveCancelInboxStep,
  LeaveInboxStep,
  ScheduleInboxStep,
  TeamLeave,
} from "../../services/approvals";

const LEAVE_TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차",
  HALF_AM: "오전반차",
  HALF_PM: "오후반차",
  QUARTER_AM: "오전반반차",
  QUARTER_PM: "오후반반차",
  COMPENSATORY: "대체휴무",
  COMPENSATORY_HALF: "대체휴무반차",
  SICK: "병가",
  PERSONAL: "개인휴가",
  SPECIAL: "특별휴가",
  MATERNITY: "출산휴가",
  CIVIL_DEFENSE: "민방위",
  RESERVE_FORCES: "예비군훈련",
  FAMILY_EVENT: "경조사",
  BEREAVEMENT: "경조사",
  FAMILY_MARRIAGE: "결혼",
  FAMILY_BIRTH: "출산",
  FAMILY_BEREAVEMENT: "사망(조사)",
};

function fmtRange(start: string, end: string): string {
  const f = (s: string) => {
    const d = new Date(s);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  };
  return start.slice(0, 10) === end.slice(0, 10) ? f(start) : `${f(start)} ~ ${f(end)}`;
}

// 취소 불가 사유(서버 cancelBlock) → 짧은 표시 (웹 원장 화면과 같은 표)
const CANCEL_BLOCK_LABEL: Record<string, string> = {
  PAST: "지난 휴가 — 취소할 수 없습니다",
  NEEDS_REQUEST: "승인된 휴가 — 본인이 취소 요청을 올려야 합니다",
  MAIN_ONLY: "다른 원장의 신청 — 메인 원장만 취소할 수 있습니다",
};

type RejectTarget = { kind: "leave" | "schedule" | "leaveCancel"; id: string } | null;

export default function ApprovalsScreen() {
  const [leave, setLeave] = useState<LeaveInboxStep[]>([]);
  const [schedule, setSchedule] = useState<ScheduleInboxStep[]>([]);
  const [cancelReqs, setCancelReqs] = useState<LeaveCancelInboxStep[]>([]);   // 휴가 취소 결재(9/11)
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RejectTarget>(null);
  const [rejectReason, setRejectReason] = useState("");
  // 결재함 | 휴가 내역 — 휴가 내역은 결재함에서 빠진 건(내가 승인해 넘긴 건, 원장 선 최종승인건)을
  // 취소하는 자리다(웹 원장 화면 "휴가 내역" 탭과 짝, 2026-09-10 디렉터 지시)
  const [tab, setTab] = useState<"inbox" | "history">("inbox");
  const [history, setHistory] = useState<TeamLeave[]>([]);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [myId, setMyId] = useState("");

  const load = useCallback(async () => {
    try {
      const [l, s, h, c] = await Promise.all([
        getLeaveApprovals(),
        getScheduleApprovals(),
        getTeamLeaves().catch(() => null),   // 내역 실패가 결재함까지 막지 않게
        getLeaveCancelApprovals().catch(() => [] as LeaveCancelInboxStep[]),
      ]);
      setLeave(l);
      setSchedule(s);
      setCancelReqs(c);
      setHistoryFailed(h === null);
      // 실패하면 비운다 — 옛 목록이 실패 문구와 함께 남으면 지금 상태로 오해한다(9/10 검증 지적)
      setHistory(h ?? []);
    } catch (error) {
      console.error("❌ Failed to load approvals:", error);
      Alert.alert("오류", "결재 목록을 불러오지 못했습니다.");
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

  const approve = async (kind: "leave" | "schedule" | "leaveCancel", id: string) => {
    setProcessingId(id);
    try {
      if (kind === "leave") await decideLeave(id, "approve");
      else if (kind === "leaveCancel") await decideLeaveCancel(id, "approve");
      else await decideSchedule(id, "approve");
      await load();
    } catch (error: any) {
      Alert.alert("승인 실패", error?.response?.data?.error || "처리 중 오류가 발생했습니다.");
    } finally {
      setProcessingId(null);
    }
  };

  // 취소 — 반려와 다르다. 반려는 결재 결과로 기록에 남고, 취소는 신청 자체를 거둔다.
  // 잘못 낸 신청을 반려로 처리하면 기록에 "반려당함"으로 남아 나중에 오해를 산다.
  const cancel = async (
    kind: "leave" | "schedule",
    id: string,
    who: string,
    opts: { approved?: boolean; ownerId?: string } = {}
  ) => {
    // 본인 건인지는 누르는 순간에 판단한다 — 내 정보가 아직 없으면 그 자리에서 읽는다
    // (종전엔 로딩 전에 누르면 본인 건에도 "신청자에게 알림이 갑니다"가 떴다)
    const me = myId || (await storage.getUser().catch(() => null))?.id || "";
    const mine = !!opts.ownerId && opts.ownerId === me;
    Alert.alert(
      "신청 취소",
      mine
        ? "내 휴가 신청을 취소할까요?"   // 본인 건은 알림이 가지 않는다
        : `${who}님의 신청을 취소할까요?${opts.approved ? "\n승인된 휴가라 차감된 연차가 되돌아갑니다." : ""}\n\n반려와 달리 결재 기록에 남지 않고, 신청자에게 알림이 갑니다.`,
      [
        { text: "닫기", style: "cancel" },
        {
          text: "취소하기",
          style: "destructive",
          onPress: async () => {
            setProcessingId(id);
            try {
              if (kind === "leave") await cancelLeave(id);
              else await cancelSchedule(id);
              await load();
            } catch (error: any) {
              Alert.alert("취소 실패", error?.response?.data?.error || "처리 중 오류가 발생했습니다.");
            } finally {
              setProcessingId(null);
            }
          },
        },
      ]
    );
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    const { kind, id } = rejectTarget;
    setProcessingId(id);
    const reason = rejectReason.trim() || undefined;
    setRejectTarget(null);
    setRejectReason("");
    try {
      if (kind === "leave") await decideLeave(id, "reject", reason);
      else if (kind === "leaveCancel") await decideLeaveCancel(id, "reject", reason);
      else await decideSchedule(id, "reject", reason);
      await load();
    } catch (error: any) {
      Alert.alert("반려 실패", error?.response?.data?.error || "처리 중 오류가 발생했습니다.");
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  const total = leave.length + schedule.length + cancelReqs.length;

  const Actions = ({ kind, id, who, canCancel }: { kind: "leave" | "schedule"; id: string; who: string; canCancel?: boolean }) => (
    <View style={styles.actions}>
      <TouchableOpacity
        style={[styles.btn, styles.approveBtn]}
        disabled={processingId === id}
        onPress={() => approve(kind, id)}
      >
        {processingId === id ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <>
            <Ionicons name="checkmark" size={16} color="#fff" />
            <Text style={styles.btnText}>승인</Text>
          </>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.btn, styles.rejectBtn]}
        disabled={processingId === id}
        onPress={() => setRejectTarget({ kind, id })}
      >
        <Ionicons name="close" size={16} color="#dc2626" />
        <Text style={[styles.btnText, { color: "#dc2626" }]}>반려</Text>
      </TouchableOpacity>
      {/* 취소는 서버 판정(canCancel)으로만 — 원장끼리는 메인 원장만, 지난 휴가는 불가 등 */}
      {canCancel && (
        <TouchableOpacity
          style={[styles.btn, styles.cancelBtn]}
          disabled={processingId === id}
          onPress={() => cancel(kind, id, who)}
        >
          <Ionicons name="trash-outline" size={15} color="#6b7280" />
          <Text style={[styles.btnText, { color: "#6b7280" }]}>취소</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <>
      <View style={styles.tabs}>
        {(["inbox", "history"] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tabBtn, tab === t && styles.tabBtnOn]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>
              {t === "inbox" ? `결재함 (${total})` : `휴가 내역 (${history.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {tab === "inbox" && total === 0 && (
          <View style={styles.emptyWrap}>
            <Ionicons name="checkmark-done-circle-outline" size={48} color="#d1d5db" />
            <Text style={styles.empty}>결재할 항목이 없습니다.</Text>
          </View>
        )}

        {tab === "inbox" && leave.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>휴가 ({leave.length})</Text>
            {leave.map((step) => {
              const r = step.leaveRequest;
              return (
                <View key={step.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.who}>
                      {r.user.branch ? `[${r.user.branch}] ` : ""}{r.user.name}
                    </Text>
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{LEAVE_TYPE_LABEL[r.type] || r.type}</Text>
                    </View>
                  </View>
                  <Text style={styles.line}>{fmtRange(r.startDate, r.endDate)} · {r.days}일</Text>
                  {!!r.reason && <Text style={styles.reason}>{r.reason}</Text>}
                  {!!r.attachmentUrl && (
                    <TouchableOpacity onPress={() => Linking.openURL(fileUri(r.attachmentUrl))} style={styles.attachLink}>
                      <Ionicons name="document-attach-outline" size={15} color="#2563eb" />
                      <Text style={styles.attachLinkText} numberOfLines={1}>{r.attachmentName || "첨부 보기"}</Text>
                    </TouchableOpacity>
                  )}
                  {!!r.approvalSteps?.length && (
                    <Text style={styles.chain}>
                      {r.approvalSteps.map((s) => `${s.order}. ${stepLabel(s)}`).join("  →  ")}
                    </Text>
                  )}
                  <Actions kind="leave" id={r.id} who={r.user?.name ?? "직원"} canCancel={r.canCancel} />
                </View>
              );
            })}
          </View>
        )}

        {tab === "inbox" && schedule.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>근무일정 ({schedule.length})</Text>
            {schedule.map((step) => {
              const r = step.scheduleRequest;
              return (
                <View key={step.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.who}>
                      {r.user.branch ? `[${r.user.branch}] ` : ""}{r.user.name}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: "#f5f3ff" }]}>
                      <Text style={[styles.badgeText, { color: "#7c3aed" }]}>{r.templateName || "근무"}</Text>
                    </View>
                  </View>
                  <Text style={styles.line}>{fmtRange(r.startDate, r.endDate)} · {r.totalHours}시간</Text>
                  {!!r.reason && <Text style={styles.reason}>{r.reason}</Text>}
                  {!!r.approvalSteps?.length && (
                    <Text style={styles.chain}>
                      {r.approvalSteps.map((s) => `${s.order}. ${stepLabel(s)}`).join("  →  ")}
                    </Text>
                  )}
                  <Actions kind="schedule" id={r.id} who={r.user?.name ?? "직원"} canCancel={r.canCancel} />
                </View>
              );
            })}
          </View>
        )}

        {tab === "inbox" && cancelReqs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>휴가 취소 ({cancelReqs.length})</Text>
            {cancelReqs.map((step) => {
              const c = step.cancelRequest;
              const r = c.leaveRequest;
              return (
                <View key={step.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.who}>
                      {c.user.branch ? `[${c.user.branch}] ` : ""}{c.user.name}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: "#fef2f2" }]}>
                      <Text style={[styles.badgeText, { color: "#dc2626" }]}>취소 요청</Text>
                    </View>
                  </View>
                  <Text style={styles.line}>{LEAVE_TYPE_LABEL[r.type] || r.type} · {fmtRange(r.startDate, r.endDate)} · {r.days}일</Text>
                  {!!c.reason && <Text style={styles.reason}>취소 사유: {c.reason}</Text>}
                  <Text style={styles.chain}>최종 승인되면 휴가가 취소되고 연차가 복구됩니다. 반려하면 휴가는 그대로입니다.</Text>
                  {!!c.approvalSteps?.length && (
                    <Text style={styles.chain}>
                      {c.approvalSteps.map((s) => `${s.order}. ${stepLabel(s)}${s.status === "APPROVED" ? " ✓" : ""}`).join("  →  ")}
                    </Text>
                  )}
                  <View style={styles.actions}>
                    <TouchableOpacity
                      style={[styles.btn, styles.approveBtn]}
                      disabled={processingId === c.id}
                      onPress={() => approve("leaveCancel", c.id)}
                    >
                      {processingId === c.id ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="checkmark" size={16} color="#fff" />
                          <Text style={styles.btnText}>승인</Text>
                        </>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.btn, styles.rejectBtn]}
                      disabled={processingId === c.id}
                      onPress={() => setRejectTarget({ kind: "leaveCancel", id: c.id })}
                    >
                      <Ionicons name="close" size={16} color="#dc2626" />
                      <Text style={[styles.btnText, { color: "#dc2626" }]}>반려</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {tab === "history" && (
          <View style={styles.section}>
            {historyFailed && (
              <Text style={styles.empty}>휴가 내역을 불러오지 못했습니다. 아래로 당겨 다시 시도해주세요.</Text>
            )}
            {!historyFailed && history.length === 0 && (
              <View style={styles.emptyWrap}>
                <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
                <Text style={styles.empty}>진행 중이거나 예정된 휴가가 없습니다.</Text>
              </View>
            )}
            {history.map((r) => {
              const approved = r.status === "APPROVED";
              const note = r.cancelBlock ? CANCEL_BLOCK_LABEL[r.cancelBlock] : undefined;
              return (
                <View key={r.id} style={styles.card}>
                  <View style={styles.cardHead}>
                    <Text style={styles.who}>
                      {r.user.branch ? `[${r.user.branch}] ` : ""}{r.user.name}
                    </Text>
                    <View style={[styles.badge, { backgroundColor: approved ? "#f0fdf4" : "#fffbeb" }]}>
                      <Text style={[styles.badgeText, { color: approved ? "#15803d" : "#b45309" }]}>
                        {approved ? "승인" : "진행 중"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.line}>
                    {LEAVE_TYPE_LABEL[r.type] || r.type} · {fmtRange(r.startDate, r.endDate)} · {r.days}일
                  </Text>
                  {!!r.approvalSteps?.length && (
                    <Text style={styles.chain}>
                      {r.approvalSteps.map((s) => `${s.order}. ${stepLabel(s)}${s.status === "APPROVED" ? " ✓" : ""}`).join("  →  ")}
                    </Text>
                  )}
                  {!!r.pendingCancel && <Text style={styles.blockNote}>취소 결재 진행 중</Text>}
                  {r.canCancel ? (
                    <TouchableOpacity
                      style={[styles.btn, styles.cancelBtn, { marginTop: 14 }]}
                      disabled={processingId === r.id}
                      onPress={() => cancel("leave", r.id, r.user.name, { approved, ownerId: r.userId })}
                    >
                      {processingId === r.id ? (
                        <ActivityIndicator size="small" color="#6b7280" />
                      ) : (
                        <>
                          <Ionicons name="trash-outline" size={15} color="#6b7280" />
                          <Text style={[styles.btnText, { color: "#6b7280" }]}>취소</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ) : note ? (
                    <Text style={styles.blockNote}>{note}</Text>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>반려 사유</Text>
            <TextInput
              style={styles.input}
              placeholder="사유를 입력하세요 (선택)"
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
            />
            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.modalCancel} onPress={() => { setRejectTarget(null); setRejectReason(""); }}>
                <Text style={styles.modalCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalConfirm} onPress={confirmReject}>
                <Text style={styles.modalConfirmText}>반려</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  tabs: { flexDirection: "row", backgroundColor: "#fff", borderBottomWidth: 1, borderBottomColor: "#e5e7eb" },
  tabBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabBtnOn: { borderBottomColor: "#4f46e5" },
  tabText: { fontSize: 14, color: "#6b7280", fontWeight: "600" },
  tabTextOn: { color: "#4f46e5" },
  blockNote: { fontSize: 12, color: "#9ca3af", marginTop: 12 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f3f4f6" },
  emptyWrap: { alignItems: "center", paddingTop: 80 },
  empty: { color: "#9ca3af", fontSize: 15, marginTop: 12 },
  section: { padding: 16, paddingBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#111827", marginBottom: 10 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  who: { fontSize: 16, fontWeight: "600", color: "#111827", flex: 1 },
  badge: { backgroundColor: "#eff6ff", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 12, color: "#2563eb", fontWeight: "600" },
  line: { fontSize: 14, color: "#374151", marginTop: 8 },
  reason: { fontSize: 13, color: "#6b7280", marginTop: 4 },
  attachLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  attachLinkText: { fontSize: 13, color: "#2563eb", textDecorationLine: "underline", flexShrink: 1 },
  chain: { fontSize: 12, color: "#9ca3af", marginTop: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 40, borderRadius: 8 },
  approveBtn: { backgroundColor: "#16a34a" },
  rejectBtn: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#fca5a5" },
  cancelBtn: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db" },
  btnText: { fontSize: 14, fontWeight: "600", color: "#fff" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: "bold", color: "#111827", marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: "top", color: "#111827" },
  modalBtns: { flexDirection: "row", gap: 8, marginTop: 16 },
  modalCancel: { flex: 1, height: 44, borderRadius: 8, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  modalCancelText: { fontSize: 15, color: "#374151", fontWeight: "600" },
  modalConfirm: { flex: 1, height: 44, borderRadius: 8, backgroundColor: "#dc2626", alignItems: "center", justifyContent: "center" },
  modalConfirmText: { fontSize: 15, color: "#fff", fontWeight: "600" },
});
