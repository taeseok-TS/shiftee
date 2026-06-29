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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { DashboardStats, Announcement } from "@shiftee/api";
import * as api from "../services/api";
import * as storage from "../services/storage";

// 휴가 유형 라벨 (대기 결재 내역 표시용)
const TYPE_LABEL: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차",
  QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
  SICK: "병가", PERSONAL: "개인휴가", SPECIAL: "특별휴가",
  COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차",
  CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련",
  FAMILY_EVENT: "경조사", BEREAVEMENT: "경조사", MATERNITY: "출산휴가",
  FAMILY_MARRIAGE: "결혼", FAMILY_BIRTH: "출산", FAMILY_BEREAVEMENT: "사망(조사)",
};

type ModalKind = "contract" | "approval" | "announcement";

export default function HomeScreen() {
  const [userName, setUserName] = useState("");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [modal, setModal] = useState<ModalKind | null>(null);
  const [activeAnn, setActiveAnn] = useState<Announcement | null>(null);
  const [approvalLines, setApprovalLines] = useState<string[] | null>(null); // null=로딩중

  const load = useCallback(async () => {
    try {
      const [user, s, anns] = await Promise.all([
        storage.getUser(),
        api.getDashboardStats(),
        api.getAnnouncements(),
      ]);
      setUserName(user?.name ?? "");
      setStats(s);
      setAnnouncements(anns.slice(0, 5));
    } catch (error) {
      console.error("❌ Failed to load home:", error);
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

  // 대기 결재(내 신청 중) 월·유형별 집계
  const openApproval = useCallback(async () => {
    setModal("approval");
    setApprovalLines(null);
    try {
      const [leave, sched] = await Promise.all([
        api.getLeaveRequests().catch(() => []),
        api.getScheduleRequests("PENDING").catch(() => []),
      ]);
      const counts = new Map<string, number>();
      (leave as any[])
        .filter((r) => r.status === "PENDING")
        .forEach((r) => {
          const m = new Date(r.startDate).getMonth() + 1;
          const key = `${m}월 ${TYPE_LABEL[r.type] || r.type} 신청`;
          counts.set(key, (counts.get(key) || 0) + 1);
        });
      (sched as any[]).forEach((s) => {
        const m = new Date(s.startDate).getMonth() + 1;
        const key = `${m}월 근무일정 신청`;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      setApprovalLines([...counts.entries()].map(([k, v]) => `${k} ${v}건`));
    } catch {
      setApprovalLines([]);
    }
  }, []);

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const pendingContracts = stats?.pendingContracts ?? 0;

  const cards = [
    { key: "leave", label: "잔여 연차", value: `${stats?.leaveRemaining ?? 0}일`, icon: "umbrella-outline", color: "#10b981", onPress: undefined as undefined | (() => void) },
    { key: "contract", label: "서명 대기 계약", value: `${pendingContracts}건`, icon: "document-text-outline", color: "#f59e0b", onPress: () => setModal("contract") },
    { key: "approval", label: "대기 결재", value: `${stats?.pendingApprovals ?? 0}건`, icon: "hourglass-outline", color: "#8b5cf6", onPress: openApproval },
    { key: "work", label: "이번 달 근무", value: `${stats?.monthWorkHours ?? 0}시간`, icon: "time-outline", color: "#2563eb", onPress: undefined },
  ] as const;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>안녕하세요,</Text>
        <Text style={styles.name}>{userName || "사용자"}님 👋</Text>
        <Text style={styles.date}>{dateStr}</Text>
      </View>

      <View style={styles.grid}>
        {cards.map((c) => (
          <TouchableOpacity
            key={c.key}
            style={styles.card}
            activeOpacity={c.onPress ? 0.7 : 1}
            onPress={c.onPress}
            disabled={!c.onPress}
          >
            <View style={styles.cardTop}>
              <Ionicons name={c.icon as any} size={24} color={c.color} />
              {c.onPress && <Ionicons name="chevron-forward" size={16} color="#d1d5db" />}
            </View>
            <Text style={styles.cardValue}>{c.value}</Text>
            <Text style={styles.cardLabel}>{c.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>최근 공지</Text>
        {announcements.length === 0 ? (
          <Text style={styles.empty}>등록된 공지가 없습니다.</Text>
        ) : (
          announcements.map((a) => (
            <TouchableOpacity key={a.id} style={styles.annItem} activeOpacity={0.7} onPress={() => { setActiveAnn(a); setModal("announcement"); }}>
              <View style={styles.annHeader}>
                {a.pinned && (
                  <Ionicons name="pin" size={14} color="#ef4444" style={{ marginRight: 4 }} />
                )}
                <Text style={styles.annTitle} numberOfLines={1}>
                  {a.title}
                </Text>
              </View>
              <Text style={styles.annContent} numberOfLines={2}>
                {a.content}
              </Text>
              <Text style={styles.annMeta}>
                {a.authorName} · {new Date(a.createdAt).toLocaleDateString("ko-KR")}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </View>

      {/* 팝업 */}
      <Modal visible={modal !== null} transparent animationType="fade" onRequestClose={() => setModal(null)}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => setModal(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.popup} onPress={() => {}}>
            {modal === "contract" && (
              <>
                <Text style={styles.popupTitle}>서명 대기 계약</Text>
                {pendingContracts === 0 ? (
                  <Text style={styles.popupBody}>서명 대기 중인 계약이 없습니다.</Text>
                ) : (
                  <Text style={styles.popupBody}>
                    서명 대기 계약이 {pendingContracts}건 있습니다.{"\n\n"}
                    계약서 확인·서명은 PC에서 진행해 주세요.{"\n"}
                    웹사이트(cubetee.co.kr)에 로그인하면 계약서를 확인하고 서명할 수 있습니다.
                  </Text>
                )}
              </>
            )}

            {modal === "approval" && (
              <>
                <Text style={styles.popupTitle}>대기 결재 내역</Text>
                {approvalLines === null ? (
                  <ActivityIndicator color="#2563eb" style={{ marginVertical: 16 }} />
                ) : approvalLines.length === 0 ? (
                  <Text style={styles.popupBody}>대기 중인 결재가 없습니다.</Text>
                ) : (
                  approvalLines.map((line, i) => (
                    <View key={i} style={styles.approvalRow}>
                      <Ionicons name="hourglass-outline" size={16} color="#8b5cf6" />
                      <Text style={styles.approvalText}>{line}</Text>
                    </View>
                  ))
                )}
              </>
            )}

            {modal === "announcement" && activeAnn && (
              <>
                <View style={styles.annHeader}>
                  {activeAnn.pinned && <Ionicons name="pin" size={16} color="#ef4444" style={{ marginRight: 4 }} />}
                  <Text style={styles.popupTitle}>{activeAnn.title}</Text>
                </View>
                <Text style={styles.popupMeta}>
                  {activeAnn.authorName} · {new Date(activeAnn.createdAt).toLocaleDateString("ko-KR")}
                </Text>
                <ScrollView style={{ maxHeight: 360 }}>
                  <Text style={styles.popupBody}>{activeAnn.content}</Text>
                </ScrollView>
              </>
            )}

            <TouchableOpacity style={styles.popupClose} onPress={() => setModal(null)}>
              <Text style={styles.popupCloseText}>닫기</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f3f4f6" },
  header: { padding: 20, paddingTop: 24, backgroundColor: "#fff" },
  greeting: { fontSize: 14, color: "#6b7280" },
  name: { fontSize: 24, fontWeight: "bold", color: "#111827", marginTop: 2 },
  date: { fontSize: 13, color: "#9ca3af", marginTop: 6 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    justifyContent: "space-between",
  },
  card: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardValue: { fontSize: 22, fontWeight: "bold", color: "#111827", marginTop: 8 },
  cardLabel: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  section: { padding: 16, paddingTop: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#111827", marginBottom: 10 },
  empty: { color: "#9ca3af", fontSize: 14, paddingVertical: 12 },
  annItem: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  annHeader: { flexDirection: "row", alignItems: "center" },
  annTitle: { fontSize: 15, fontWeight: "600", color: "#111827", flex: 1 },
  annContent: { fontSize: 13, color: "#4b5563", marginTop: 4 },
  annMeta: { fontSize: 12, color: "#9ca3af", marginTop: 6 },
  // 팝업
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  popup: { backgroundColor: "#fff", borderRadius: 14, padding: 20 },
  popupTitle: { fontSize: 17, fontWeight: "700", color: "#111827", flexShrink: 1 },
  popupMeta: { fontSize: 12, color: "#9ca3af", marginTop: 6, marginBottom: 10 },
  popupBody: { fontSize: 14, color: "#374151", lineHeight: 21, marginTop: 12 },
  approvalRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  approvalText: { fontSize: 14, color: "#374151" },
  popupClose: { marginTop: 20, backgroundColor: "#2563eb", borderRadius: 8, paddingVertical: 12, alignItems: "center" },
  popupCloseText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
