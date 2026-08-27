import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  Alert,
  Modal,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRoute, RouteProp } from "@react-navigation/native";
import SignatureScreen, { SignatureViewRef } from "react-native-signature-canvas";
import { Contract } from "@shiftee/api";
import * as api from "../../services/api";
import { fileUri } from "../../services/work";

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
  // 계약서·서명 경로는 인증 게이트 대상 — 접근 티켓을 붙인 URL 로 연다 (검증관 지적 2026-08-24)
  return fileUri(path);
}

type ParamList = { ContractDetail: { id: string } };

export default function ContractDetailScreen() {
  const route = useRoute<RouteProp<ParamList, "ContractDetail">>();
  const { id } = route.params;
  const [contract, setContract] = useState<Contract | null>(null);
  const [loading, setLoading] = useState(true);
  const [myRole, setMyRole] = useState<string>("");
  useEffect(() => {
    import("../../services/storage").then((st) => st.getUser().then((u) => setMyRole(u?.role || ""))).catch(() => {});
  }, []);
  const [showSign, setShowSign] = useState(false);
  const [signing, setSigning] = useState(false);
  const sigRef = useRef<SignatureViewRef>(null);

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

  // 서명 패드에서 확인 → base64(data:image/png) 전달됨
  const handleSignature = async (sig: string) => {
    setShowSign(false);
    setSigning(true);
    try {
      await api.signContract(id, sig);
      Alert.alert("완료", "서명이 제출되었습니다.");
      await load();
    } catch (error: any) {
      Alert.alert("오류", error.response?.data?.error || "서명 제출에 실패했습니다.");
    } finally {
      setSigning(false);
    }
  };

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
  const isAdmin = myRole === "ADMIN";
  const signedFile = firstUrl(contract.signedUrl);
  // 본인 서명은 결재 순서상 자기 차례(내 단계가 PENDING)일 때만 — 결재라인 없는 구계약은 기존 SENT 기준
  const steps: any[] = (contract as any).approvalLine?.steps || [];
  const myTurn = steps.some((s) => s.approverId === (contract as any).userId && s.status === "PENDING");
  const canSign = steps.length > 0 ? myTurn : contract.status === "SENT";
  // 서명 완료 후 근로자 접근 (#129) — 템플릿 설정. 관리자는 무제한 현행
  const postSignAccess = contract.postSignAccess || "full";
  // 진행 중 계약 — 내 서명이 반영된 진행본 열람 (#110). 완료되면 완료본 버튼이 대신 뜬다
  const inProgressViewable = !isAdmin && contract.status !== "SIGNED" && !!contract.employeeSignedAt && !signedFile;

  // 서명 진행본/완료본 열기 — 계약 1건짜리 단기 링크(PDF, 최신 서명 배치)
  const openSignedDoc = async () => {
    try {
      const url = await api.getSignedDocLink(contract.id);
      if (url) Linking.openURL(url);
      else Alert.alert("오류", "문서 링크를 만들지 못했습니다.");
    } catch (e: any) {
      Alert.alert("오류", e?.response?.data?.error || "문서를 여는 중 오류가 발생했습니다.");
    }
  };

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
        {/* 직원은 완료된 계약에서 원본(서명 전 워드) 대신 완료본만 — 워드 파일 유출 방지 (디렉터 확정 2026-08-25).
            진행 중 계약은 내용 확인이 필요하니 원본을 "열람"(뷰어)으로만 연다. 관리자는 기존대로. */}
        {(isAdmin || !signedFile) && originalFile ? (
          <TouchableOpacity
            style={styles.fileBtn}
            onPress={() => {
              if (isAdmin) { openFile(originalFile); return; }
              // 직원: 다운로드가 아니라 인앱 뷰어(웹 docs/viewer)로 열람만
              const viewer = fileUri(originalFile);
              const origin = viewer.split("/api/")[0];
              Linking.openURL(`${origin}/docs/viewer?src=${encodeURIComponent(viewer)}`);
            }}
          >
            <Ionicons name="document-text-outline" size={20} color="#2563eb" />
            <Text style={styles.fileBtnText}>{isAdmin ? "계약서 원본 보기" : "계약서 내용 보기"}</Text>
            <Ionicons name="open-outline" size={18} color="#9ca3af" />
          </TouchableOpacity>
        ) : null}
        {/* 진행 중 계약 — 내 서명이 반영된 진행본 열람 (#110) */}
        {inProgressViewable ? (
          <TouchableOpacity style={styles.fileBtn} onPress={openSignedDoc}>
            <Ionicons name="create-outline" size={20} color="#f59e0b" />
            <Text style={styles.fileBtnText}>서명 진행본 보기 (PDF)</Text>
            <Ionicons name="open-outline" size={18} color="#9ca3af" />
          </TouchableOpacity>
        ) : null}
        {/* 완료본 — 템플릿의 "서명 완료 후 근로자 접근"이 none 이면 버튼 대신 안내만 (#129). 관리자는 현행 */}
        {signedFile && !isAdmin && postSignAccess === "none" ? (
          <View style={styles.fileBtn}>
            <Ionicons name="checkmark-circle-outline" size={20} color="#9ca3af" />
            <Text style={[styles.fileBtnText, { color: "#6b7280" }]}>제출 완료 (사본은 관리자에게 요청)</Text>
          </View>
        ) : signedFile ? (
          <TouchableOpacity
            style={styles.fileBtn}
            onPress={openSignedDoc /* 워드 파일 직링크 대신 재생성 PDF(수정 불가·최신 서명 배치) */}
          >
            <Ionicons name="checkmark-circle-outline" size={20} color="#10b981" />
            <Text style={styles.fileBtnText}>서명 완료본 보기 (PDF)</Text>
            <Ionicons name="open-outline" size={18} color="#9ca3af" />
          </TouchableOpacity>
        ) : null}
      </View>

      {canSign ? (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>전자 서명</Text>
          <Text style={styles.signHint}>아래 버튼을 눌러 서명하면 계약이 진행됩니다.</Text>
          <TouchableOpacity
            style={[styles.signBtn, signing && styles.btnDisabled]}
            onPress={() => setShowSign(true)}
            disabled={signing}
          >
            {signing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="create-outline" size={18} color="#fff" />
                <Text style={styles.signBtnText}>서명하기</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}

      {/* 서명 패드 모달 */}
      <Modal visible={showSign} animationType="slide" onRequestClose={() => setShowSign(false)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>서명</Text>
            <TouchableOpacity onPress={() => setShowSign(false)}>
              <Ionicons name="close" size={26} color="#374151" />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>손가락으로 아래 영역에 서명한 뒤 '확인'을 누르세요.</Text>
          <View style={styles.padWrap}>
            <SignatureScreen
              ref={sigRef}
              onOK={handleSignature}
              onEmpty={() => Alert.alert("알림", "서명을 입력해주세요.")}
              descriptionText=""
              imageType="image/png"
              webStyle={`.m-signature-pad--footer { display: none; }
                .m-signature-pad { box-shadow: none; border: none; }
                body, html { width: 100%; height: 100%; }`}
            />
          </View>
          {/* 패드 내부(웹뷰) 버튼은 기기에 따라 안 보일 수 있어 바깥 고정 버튼 사용 */}
          <View style={styles.padActions}>
            <TouchableOpacity style={styles.padClear} onPress={() => sigRef.current?.clearSignature()}>
              <Text style={styles.padClearText}>지우기</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.padConfirm} onPress={() => sigRef.current?.readSignature()}>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.padConfirmText}>서명 제출</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  signHint: { color: "#6b7280", fontSize: 13, marginBottom: 12 },
  signBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 8,
  },
  signBtnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  btnDisabled: { opacity: 0.6 },
  padActions: { flexDirection: "row", gap: 10, padding: 16, paddingBottom: 34, borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  padClear: { flex: 1, paddingVertical: 14, borderRadius: 8, borderWidth: 1, borderColor: "#d1d5db", alignItems: "center" },
  padClearText: { fontSize: 15, fontWeight: "600", color: "#374151" },
  padConfirm: { flex: 2, flexDirection: "row", gap: 6, paddingVertical: 14, borderRadius: 8, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center" },
  padConfirmText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  modalRoot: { flex: 1, backgroundColor: "#fff" },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 50,
    paddingBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: "bold", color: "#111827" },
  modalHint: { color: "#6b7280", fontSize: 13, paddingHorizontal: 20, paddingBottom: 10 },
  padWrap: { flex: 1, borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});
