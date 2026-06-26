import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ScheduleEntry, ScheduleRequest, LeaveRequest } from "@shiftee/api";
import * as api from "../../services/api";
import * as storage from "../../services/storage";

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
};

export default function ScheduleScreen() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date();
    return { year: n.getFullYear(), month: n.getMonth() + 1 };
  });
  const [shifts, setShifts] = useState<ScheduleEntry[]>([]);
  const [requests, setRequests] = useState<ScheduleRequest[]>([]);
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [myId, setMyId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    storage.getUser().then((u) => setMyId(u?.id || "")).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      const [s, r, l] = await Promise.all([
        api.getMySchedules(cursor.year, cursor.month),
        api.getScheduleRequests(),
        api.getLeaveRequests(cursor.year, cursor.month),
      ]);
      setShifts(s.sort((a, b) => a.date.localeCompare(b.date)));
      setRequests(r);
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
            <Text style={styles.sectionTitle}>내 근무일정</Text>
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
              ℹ️ 새 근무일정 신청은 웹에서 템플릿으로 작성할 수 있습니다.
            </Text>
          </View>
        </>
      )}
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
