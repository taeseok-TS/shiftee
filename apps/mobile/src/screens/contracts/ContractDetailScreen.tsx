import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRoute, RouteProp } from "@react-navigation/native";
import { Contract } from "@shiftee/api";
import * as api from "../../services/api";
import { API_URL } from "../../config";

const STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "작성중", color: "#6b7280" },
  SENT: { label: "서명 대기", color: "#f59e0b" },
  SIGNED: { label: "서명 완료", color: "#3b82f6" },
  APPROVED: { label: "승인 완료", color: "#10b981" },
  REJECTED: { label: "반려", color: "#ef4444" },
};

function firstUrl(raw?: string | null): string | null {
  if (!raw) return null;
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a[0] ?? null : raw;
  } catch {
    return raw;
  }
}

function fullUrl(path: string): string {
  if (path.startsWith("http")) return path;
  const origin = API_URL.replace(/\/api$/, "");
  return origin + path;
}

type ParamList = { ContractDetail: { id: string } };

export default function ContractDetailScreen() {
  const route = useRoute<RouteProp<ParamList, "ContractDetail">>();
  const { id } = route.params;
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const c = await api.getContract(id);
      setContract(c);
    } catch (error) {
      console.error("❌ Failed to load contract:", error);
      Alert.alert("오류", "계약서를 불러올 수 없습니다.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const openFile = async (path: string | null) => {
    if (!path) return;
    const url = fullUrl(path);
    const ok = await Linking.canOpenURL(url);
    if (ok) Linking.openURL(url);
    else Alert.alert("오류", "파일을 열 수 없습니다.");
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  if (!contract) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>계약서를 찾을 수 없습니다.</Text>
      </View>
    );
  }

  const st = STATUS[contract.status] || STATUS.DRAFT;
  const originalFile = firstUrl(contract.fileUrl);
  const signedFile = firstUrl(contract.signedUrl);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>{contract.title}</Text>
          <View style={[styles.badge, { backgroundColor: st.color }]}>
            <Text style={styles.badgeText}>{st.label}</Text>
          </View>
        </View>

        <Row label="유형" value={contract.type} />
        <Row label="직원" value={contract.user?.name ?? "-"} />
        {contract.startDate || contract.endDate ? (
          <Row label="기간" value={`${contract.startDate ?? "-"} ~ ${contract.endDate ?? "-"}`} />
        ) : null}
        {contract.employeeSignedAt ? (
          <Row label="직원 서명" value={new Date(contract.employeeSignedAt).toLocaleString("ko-KR")} />
        ) : null}
        {contract.signedAt ? (
          <Row label="완료 일시" value={new Date(contract.signedAt).toLocaleString("ko-KR")} />
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>문서</Text>
        <TouchableOpacity style={styles.fileBtn} onPress={() => openFile(originalFile)} disabled={!originalFile}>
          <Ionicons name="document-text-outline" size={20} color="#2563eb" />
          <Text style={styles.fileBtnText}>계약서 원본 보기</Text>
          <Ionicons name="open-outline" size={18} color="#9ca3af" />
        </TouchableOpacity>
        {signedFile ? (
          <TouchableOpacity style={styles.fileBtn} onPress={() => openFile(signedFile)}>
            <Ionicons name="checkmark-circle-outline" size={20} color="#10b981" />
            <Text style={styles.fileBtnText}>서명 완료본 보기</Text>
            <Ionicons name="open-outline" size={18} color="#9ca3af" />
          </TouchableOpacity>
        ) : null}
      </View>

      {contract.status === "SENT" ? (
        <View style={styles.noticeCard}>
          <Ionicons name="create-outline" size={18} color="#92400e" />
          <Text style={styles.noticeText}>
            이 계약서는 서명 대기 중입니다. 모바일 서명 기능은 곧 추가됩니다.
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f3f4f6" },
  empty: { color: "#9ca3af", fontSize: 14 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 18, margin: 16, marginBottom: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  title: { fontSize: 18, fontWeight: "bold", color: "#111827", flex: 1, marginRight: 8 },
  sectionTitle: { fontSize: 15, fontWeight: "bold", color: "#111827", marginBottom: 10 },
  row: { flexDirection: "row", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#f3f4f6" },
  rowLabel: { width: 80, color: "#6b7280", fontSize: 14 },
  rowValue: { flex: 1, color: "#111827", fontSize: 14 },
  fileBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: "#f9fafb",
    borderRadius: 8,
    marginBottom: 8,
  },
  fileBtnText: { flex: 1, fontSize: 14, fontWeight: "600", color: "#374151" },
  noticeCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fef3c7",
    borderRadius: 10,
    padding: 14,
    margin: 16,
    marginTop: 8,
  },
  noticeText: { flex: 1, color: "#92400e", fontSize: 13, lineHeight: 18 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});
