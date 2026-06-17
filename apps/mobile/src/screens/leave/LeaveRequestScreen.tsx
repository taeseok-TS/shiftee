import React, { useCallback, useEffect, useState } from "react";
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
} from "react-native";
import { LeaveType, LeaveRequest, LeaveBalance } from "@shiftee/api";
import * as api from "../../services/api";

const TYPE_LABEL: Record<string, string> = {
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

const STATUS: Record<string, { label: string; color: string }> = {
  PENDING: { label: "대기중", color: "#f59e0b" },
  APPROVED: { label: "승인", color: "#10b981" },
  REJECTED: { label: "반려", color: "#ef4444" },
};

export default function LeaveRequestScreen() {
  const [leaveType, setLeaveType] = useState<LeaveType>("ANNUAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const [balance, setBalance] = useState<LeaveBalance | null>(null);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const leaveTypes: Array<{ value: LeaveType; label: string }> = [
    { value: "ANNUAL", label: "연차" },
    { value: "SICK", label: "병가" },
    { value: "PERSONAL", label: "개인휴가" },
  ];

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

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const handleSubmit = async () => {
    if (!startDate || !endDate) {
      Alert.alert("오류", "시작일과 종료일을 입력해주세요");
      return;
    }

    setIsLoading(true);
    try {
      await api.createLeaveRequest({ type: leaveType, startDate, endDate, reason });
      Alert.alert("성공", "휴가 신청이 완료되었습니다");
      setLeaveType("ANNUAL");
      setStartDate("");
      setEndDate("");
      setReason("");
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
      </View>

      {/* 휴가 신청 폼 */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>휴가 신청</Text>
        <Text style={styles.label}>휴가 유형</Text>
        <View style={styles.typeButtons}>
          {leaveTypes.map((type) => (
            <TouchableOpacity
              key={type.value}
              style={[styles.typeButton, leaveType === type.value && styles.typeButtonActive]}
              onPress={() => setLeaveType(type.value)}
            >
              <Text style={[styles.typeButtonText, leaveType === type.value && styles.typeButtonTextActive]}>
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>시작일</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          value={startDate}
          onChangeText={setStartDate}
          editable={!isLoading}
        />

        <Text style={styles.label}>종료일</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          value={endDate}
          onChangeText={setEndDate}
          editable={!isLoading}
        />

        <Text style={styles.label}>신청 사유</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="(선택사항)"
          value={reason}
          onChangeText={setReason}
          multiline
          editable={!isLoading}
        />

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
                {r.status === "REJECTED" && r.rejectedReason ? (
                  <Text style={styles.histRejected}>반려 사유: {r.rejectedReason}</Text>
                ) : null}
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
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
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    margin: 16,
    marginTop: 8,
  },
  cardTitle: { fontSize: 16, fontWeight: "bold", color: "#111827", marginBottom: 8 },
  label: { fontSize: 14, fontWeight: "600", color: "#1f2937", marginBottom: 8, marginTop: 16 },
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
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});
