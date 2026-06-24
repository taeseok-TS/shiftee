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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  getLeaveApprovals,
  getScheduleApprovals,
  decideLeave,
  decideSchedule,
  stepLabel,
  LeaveInboxStep,
  ScheduleInboxStep,
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
};

function fmtRange(start: string, end: string): string {
  const f = (s: string) => {
    const d = new Date(s);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  };
  return start.slice(0, 10) === end.slice(0, 10) ? f(start) : `${f(start)} ~ ${f(end)}`;
}

type RejectTarget = { kind: "leave" | "schedule"; id: string } | null;

export default function ApprovalsScreen() {
  const [leave, setLeave] = useState<LeaveInboxStep[]>([]);
  const [schedule, setSchedule] = useState<ScheduleInboxStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<RejectTarget>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([getLeaveApprovals(), getScheduleApprovals()]);
      setLeave(l);
      setSchedule(s);
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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const approve = async (kind: "leave" | "schedule", id: string) => {
    setProcessingId(id);
    try {
      if (kind === "leave") await decideLeave(id, "approve");
      else await decideSchedule(id, "approve");
      await load();
    } catch (error: any) {
      Alert.alert("승인 실패", error?.response?.data?.error || "처리 중 오류가 발생했습니다.");
    } finally {
      setProcessingId(null);
    }
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

  const total = leave.length + schedule.length;

  const Actions = ({ kind, id }: { kind: "leave" | "schedule"; id: string }) => (
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
    </View>
  );

  return (
    <>
      <ScrollView
        style={styles.container}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {total === 0 && (
          <View style={styles.emptyWrap}>
            <Ionicons name="checkmark-done-circle-outline" size={48} color="#d1d5db" />
            <Text style={styles.empty}>결재할 항목이 없습니다.</Text>
          </View>
        )}

        {leave.length > 0 && (
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
                  {!!r.approvalSteps?.length && (
                    <Text style={styles.chain}>
                      {r.approvalSteps.map((s) => `${s.order}. ${stepLabel(s)}`).join("  →  ")}
                    </Text>
                  )}
                  <Actions kind="leave" id={r.id} />
                </View>
              );
            })}
          </View>
        )}

        {schedule.length > 0 && (
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
                  <Actions kind="schedule" id={r.id} />
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <View style={styles.modalBg}>
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
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
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
  chain: { fontSize: 12, color: "#9ca3af", marginTop: 8 },
  actions: { flexDirection: "row", gap: 8, marginTop: 14 },
  btn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, height: 40, borderRadius: 8 },
  approveBtn: { backgroundColor: "#16a34a" },
  rejectBtn: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#fca5a5" },
  btnText: { fontSize: 14, fontWeight: "600", color: "#fff" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  modalCard: { backgroundColor: "#fff", borderRadius: 14, padding: 20 },
  modalTitle: { fontSize: 17, fontWeight: "bold", color: "#111827", marginBottom: 12 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 12, fontSize: 14, minHeight: 80, textAlignVertical: "top" },
  modalBtns: { flexDirection: "row", gap: 8, marginTop: 16 },
  modalCancel: { flex: 1, height: 44, borderRadius: 8, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  modalCancelText: { fontSize: 15, color: "#374151", fontWeight: "600" },
  modalConfirm: { flex: 1, height: 44, borderRadius: 8, backgroundColor: "#dc2626", alignItems: "center", justifyContent: "center" },
  modalConfirmText: { fontSize: 15, color: "#fff", fontWeight: "600" },
});
