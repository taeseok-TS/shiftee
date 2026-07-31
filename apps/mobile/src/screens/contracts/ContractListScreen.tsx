import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Alert,
  Linking,
  TextInput,
  ScrollView,
  Image,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { WebView } from "react-native-webview";
import SignatureScreen, { SignatureViewRef } from "react-native-signature-canvas";
import { Contract } from "@shiftee/api";
import * as api from "../../services/api";
import { API_URL } from "../../config";

// 브라우저 열람용 URL (워드 등 오피스 문서는 MS 온라인 뷰어)
function viewerUrl(raw?: string | null): string | null {
  if (!raw) return null;
  let path = raw;
  try {
    const a = JSON.parse(raw);
    path = Array.isArray(a) ? a[0] : raw;
  } catch { /* 그대로 사용 */ }
  if (!path) return null;
  const origin = API_URL.replace(/\/api$/, "");
  const full = path.startsWith("http") ? path : origin + path;
  // 워드는 웹의 자체 인앱 뷰어(즉시 렌더). 엑셀·PPT만 MS 온라인 뷰어 유지
  if (/\.docx?$/i.test(full)) return `${origin}/docs/viewer?src=${encodeURIComponent(full)}`;
  if (/\.(pptx?|xlsx?)$/i.test(full))
    return `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(full)}`;
  return full;
}

export default function ContractListScreen() {
  const navigation = useNavigation<any>();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [myApprovals, setMyApprovals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // 결재 승인 서명
  const [signTarget, setSignTarget] = useState<any | null>(null);
  const [signing, setSigning] = useState(false);
  const [consentChoices, setConsentChoices] = useState<Record<string, string>>({});
  const [signStep, setSignStep] = useState(1); // 개인정보동의서: 1=동의 확인, 2=서명
  const [docViewerUrl, setDocViewerUrl] = useState<string | null>(null); // 동의서 전문 인앱 뷰어
  const [myProfile, setMyProfile] = useState<{ address: string; birthDate: string }>({ address: "", birthDate: "" });
  const [myId, setMyId] = useState("");
  const [profileInput, setProfileInput] = useState<{ 주소: string; 생년월일: string }>({ 주소: "", 생년월일: "" });
  const [empFieldInput, setEmpFieldInput] = useState<Record<string, string>>({}); // 직원 직접입력 필드값(퇴사일자 등)
  // 저장된 결재 서명 — 있으면 원클릭 승인 (본인 계약 서명은 항상 직접 그림)
  const [mySigUrl, setMySigUrl] = useState<string | null>(null);
  const [drawNewSig, setDrawNewSig] = useState(false);
  const [saveSigDefault, setSaveSigDefault] = useState(true);
  const sigRef = useRef<SignatureViewRef>(null);
  const CONSENT_LABELS: Record<string, string> = { 동의고유식별: "고유식별정보(외국인등록번호) 수집·이용", 동의채용정보: "채용정보 등 마케팅 정보 수신" };
  const consentKeys = signTarget?.extraFields ? Object.keys(CONSENT_LABELS).filter(k => k in signTarget.extraFields) : [];
  // 서명 대상이 요구하는 프로필 필드 중 아직 비어 있는 것 — 본인(계약 대상 직원)이 서명할 때만
  // (원장/본부 등 결재자는 대상 직원 정보이므로 입력 요구 X)
  const missingProfile: string[] = (signTarget?.userId === myId ? (signTarget?.profileFields || []) : []).filter((f: string) =>
    f === "주소" ? !myProfile.address : f === "생년월일" ? !myProfile.birthDate : false);
  // 직원 직접입력 필드 — 본인(계약 대상 직원)이 서명할 때만 (원장/본부 결재 시엔 이미 채워짐)
  const empFields: string[] = (signTarget?.userId === myId ? signTarget?.employeeFields : null) || [];
  const isEmpDateField = (f: string) => /일자|날짜|일$/.test(f);
  // 필드명으로 입력 타입 유추: 체크_→체크박스, ~일→날짜, 그 외→텍스트
  const empFieldType = (f: string): "check" | "date" | "text" => f.startsWith("체크_") ? "check" : isEmpDateField(f) ? "date" : "text";
  const empFieldLabel = (f: string) => f.startsWith("체크_") ? f.slice(3) : f;

  useEffect(() => {
    loadContracts();
    api.getMyProfile().then(p => { setMyId(p.id || ""); setMySigUrl(p.signatureUrl || null); setMyProfile({ address: p.address || "", birthDate: p.birthDate ? String(p.birthDate).slice(0, 10) : "" }); }).catch(() => {});
  }, []);

  const loadContracts = async () => {
    try {
      const [data, approvals] = await Promise.all([
        api.getContracts(),
        api.getMyContractApprovals().catch(() => []),
      ]);
      setContracts(data);
      setMyApprovals(approvals);
    } catch (error) {
      console.error("❌ Failed to load contracts:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // 결재 승인 (서명 패드에서 확인 → base64 전달)
  const handleApproveSignature = async (sig: string) => {
    if (!signTarget) return;
    const id = signTarget.id;
    const hasConsent = consentKeys.length > 0;
    const choices = { ...consentChoices };
    // 프로필 미입력 검증
    let profile: Record<string, string> | undefined;
    if (missingProfile.length) {
      profile = {};
      if (missingProfile.includes("주소")) {
        if (!profileInput.주소.trim()) { Alert.alert("알림", "주소를 입력해주세요."); return; }
        profile.주소 = profileInput.주소.trim();
      }
      if (missingProfile.includes("생년월일")) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(profileInput.생년월일)) { Alert.alert("알림", "생년월일을 YYYY-MM-DD로 입력해주세요."); return; }
        profile.생년월일 = profileInput.생년월일;
      }
    }
    // 직원 직접입력 필드(퇴사사유·지급희망일·지급금품 체크 등) — 문서에만 반영(프로필 저장 X)
    let fields: Record<string, string> | undefined;
    if (empFields.length) {
      fields = {};
      for (const f of empFields) {
        const type = empFieldType(f);
        if (type === "check") { fields[f] = empFieldInput[f] === "□" ? "□" : "☑"; continue; } // 기본 체크, 명시적 해제만 □
        const v = (empFieldInput[f] || "").trim();
        const optional = f.includes("기타");
        if (!v) { if (optional) { fields[f] = ""; continue; } Alert.alert("알림", `${empFieldLabel(f)}을(를) 입력해주세요.`); return; }
        if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { Alert.alert("알림", `${empFieldLabel(f)}을(를) YYYY-MM-DD로 입력해주세요.`); return; }
        fields[f] = v;
      }
    }
    setSignTarget(null);
    setSigning(true);
    try {
      if (hasConsent || profile || fields) {
        await api.signContractWithConsent(id, sig, true, hasConsent ? choices : undefined, profile, fields);
        if (profile) setMyProfile(p => ({ address: profile!.주소 ?? p.address, birthDate: profile!.생년월일 ?? p.birthDate }));
      } else if (signTarget.userId !== myId && saveSigDefault) {
        // 결재자(원장·본부)가 그린 서명 — 기본 서명으로 저장해 다음부터 원클릭
        await api.signContractAndSave(id, sig);
        api.getMyProfile().then(p => setMySigUrl(p.signatureUrl || null)).catch(() => {});
      } else {
        await api.signContract(id, sig, true);
      }
      Alert.alert("완료", "결재를 승인했습니다.");
      await loadContracts();
    } catch (error: any) {
      Alert.alert("오류", error?.response?.data?.error || "결재 처리에 실패했습니다.");
    } finally {
      setSigning(false);
    }
  };

  // 저장된 서명으로 원클릭 승인 (결재자 전용)
  const handleApproveSaved = async () => {
    if (!signTarget) return;
    const id = signTarget.id;
    setSignTarget(null);
    setSigning(true);
    try {
      await api.signContractSaved(id);
      Alert.alert("완료", "저장된 서명으로 결재를 승인했습니다.");
      await loadContracts();
    } catch (error: any) {
      Alert.alert("오류", error?.response?.data?.error || "결재 처리에 실패했습니다.");
    } finally {
      setSigning(false);
    }
  };

  const renderContract = ({ item }: { item: Contract }) => {
    const statusColor =
      {
        DRAFT: "#6b7280",
        SENT: "#f59e0b",
        SIGNED: "#3b82f6",
        APPROVED: "#10b981",
        REJECTED: "#ef4444",
      }[item.status] || "#6b7280";

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => navigation.navigate("ContractDetail", { id: item.id })}
      >
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>{item.title}</Text>
          <View style={[styles.badge, { backgroundColor: statusColor }]}>
            <Text style={styles.badgeText}>{item.status}</Text>
          </View>
        </View>
        <Text style={styles.cardSubtitle}>{item.user.name}</Text>
        {item.startDate && item.endDate && (
          <Text style={styles.cardDate}>
            {item.startDate} ~ {item.endDate}
          </Text>
        )}
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  // 내 결재 대기 카드 (결재자용 — 요약 확인 후 서명 승인)
  const renderApprovalHeader = () =>
    myApprovals.length === 0 ? null : (
      <View style={styles.approvalSection}>
        <Text style={styles.approvalTitle}>내 결재 대기 ({myApprovals.length})</Text>
        {myApprovals.map((c) => {
          const view = viewerUrl(c.fileUrl);
          const extras: [string, string][] = Object.entries(c.extraFields || {}) as [string, string][];
          return (
            <View key={c.id} style={styles.approvalCard}>
              <Text style={styles.cardTitle}>{c.title}</Text>
              <Text style={styles.cardSubtitle}>{c.user?.name}{c.user?.branch ? ` · ${c.user.branch}` : ""}</Text>
              {(c.startDate || c.endDate) && (
                <Text style={styles.cardDate}>계약기간 {String(c.startDate || "?").slice(0, 10)} ~ {String(c.endDate || "?").slice(0, 10)}</Text>
              )}
              {extras.map(([k, v]) => (
                <Text key={k} style={styles.cardDate}>{k} {v}</Text>
              ))}
              <View style={styles.approvalBtns}>
                {view && (
                  <TouchableOpacity style={styles.viewBtn} onPress={() => Linking.openURL(view)}>
                    <Ionicons name="eye-outline" size={16} color="#374151" />
                    <Text style={styles.viewBtnText}>계약서 보기</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.approveBtn} onPress={() => { setConsentChoices({ 동의고유식별: c.extraFields?.동의고유식별 || "동의", 동의채용정보: c.extraFields?.동의채용정보 || "동의" }); setProfileInput({ 주소: "", 생년월일: "" }); setEmpFieldInput({}); setDrawNewSig(false); setSignStep(1); setSignTarget(c); }} disabled={signing}>
                  {signing ? <ActivityIndicator size="small" color="#fff" /> : (
                    <>
                      <Ionicons name="create-outline" size={16} color="#fff" />
                      <Text style={styles.approveBtnText}>승인 (서명)</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>
    );

  return (
    <View style={styles.container}>
      {contracts.length === 0 && myApprovals.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>계약서가 없습니다</Text>
        </View>
      ) : (
        <FlatList
          data={contracts}
          renderItem={renderContract}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={renderApprovalHeader}
        />
      )}

      {/* 결재 승인 서명 패드 */}
      <Modal visible={!!signTarget} animationType="slide" onRequestClose={() => setSignTarget(null)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>결재 승인 서명</Text>
            <TouchableOpacity onPress={() => setSignTarget(null)}>
              <Ionicons name="close" size={26} color="#374151" />
            </TouchableOpacity>
          </View>
          <Text style={styles.modalHint}>
            '{signTarget?.title}'{consentKeys.length > 0 && signStep === 1 ? " — 동의 항목을 확인하고 선택하세요." : " — 승인하면 다음 결재자에게 전달됩니다."}
          </Text>

          {/* ── 1단계: 개인정보동의서 동의 확인 ── */}
          {consentKeys.length > 0 && signStep === 1 && (
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 12 }}>
              <TouchableOpacity style={styles.viewDocBtn}
                onPress={() => { const u = viewerUrl(signTarget.fileUrl); if (u) setDocViewerUrl(u); }}>
                <Ionicons name="eye-outline" size={16} color="#4338ca" />
                <Text style={styles.viewDocBtnText}>동의서 전문 보기</Text>
              </TouchableOpacity>
              <Text style={styles.consentNotice}>
                개인정보 수집·이용, 민감정보, 제3자 제공 등 필수 항목은 동의로 처리됩니다 (미동의 시 채용 제한). 아래 선택 항목만 자유롭게 고르세요.
              </Text>
              <View style={styles.consentBox}>
                <Text style={styles.consentTitle}>선택 동의 항목 (동의하지 않아도 됩니다)</Text>
                {consentKeys.map(k => (
                  <View key={k} style={{ marginBottom: 6 }}>
                    <Text style={styles.consentLabel}>{CONSENT_LABELS[k]}</Text>
                    <View style={{ flexDirection: "row", gap: 14, marginTop: 3 }}>
                      {["동의", "미동의"].map(opt => (
                        <TouchableOpacity key={opt} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                          onPress={() => setConsentChoices(prev => ({ ...prev, [k]: opt }))}>
                          <Ionicons name={(consentChoices[k] || "동의") === opt ? "radio-button-on" : "radio-button-off"} size={18} color="#2563eb" />
                          <Text style={styles.consentOpt}>{opt}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
              </View>
              {missingProfile.length > 0 && (
                <View style={[styles.consentBox, { borderColor: "#bfdbfe", backgroundColor: "#eff6ff" }]}>
                  <Text style={[styles.consentTitle, { color: "#1e40af" }]}>필요한 정보 입력 (프로필에 저장됩니다)</Text>
                  {missingProfile.includes("주소") && (
                    <View style={{ marginBottom: 6 }}><Text style={styles.consentLabel}>주소</Text>
                      <TextInput style={styles.profileInput} placeholder="예: 서울시 강남구 테헤란로 123"
                        value={profileInput.주소} onChangeText={t => setProfileInput(p => ({ ...p, 주소: t }))} /></View>
                  )}
                  {missingProfile.includes("생년월일") && (
                    <View><Text style={styles.consentLabel}>생년월일 (YYYY-MM-DD)</Text>
                      <TextInput style={styles.profileInput} placeholder="예: 1995-03-15" keyboardType="numbers-and-punctuation"
                        value={profileInput.생년월일} onChangeText={t => setProfileInput(p => ({ ...p, 생년월일: t }))} /></View>
                  )}
                </View>
              )}
              <TouchableOpacity style={[styles.padConfirm, { marginTop: 8 }]} onPress={() => {
                if (missingProfile.includes("주소") && !profileInput.주소.trim()) { Alert.alert("알림", "주소를 입력해주세요."); return; }
                if (missingProfile.includes("생년월일") && !/^\d{4}-\d{2}-\d{2}$/.test(profileInput.생년월일)) { Alert.alert("알림", "생년월일을 YYYY-MM-DD로 입력해주세요."); return; }
                setSignStep(2);
              }}>
                <Text style={styles.padConfirmText}>확인 완료 · 서명하기 →</Text>
              </TouchableOpacity>
            </ScrollView>
          )}

          {/* ── 서명 단계 (2단계 또는 동의 없는 문서) ── */}
          {(consentKeys.length === 0 || signStep === 2) && (
            <>
              {/* 동의 없는 문서(비밀유지 등)의 프로필 미입력 항목 */}
              {consentKeys.length === 0 && missingProfile.length > 0 && (
                <View style={[styles.consentBox, { borderColor: "#bfdbfe", backgroundColor: "#eff6ff" }]}>
                  <Text style={[styles.consentTitle, { color: "#1e40af" }]}>계약서에 필요한 정보 입력 (프로필에 저장됩니다)</Text>
                  {missingProfile.includes("주소") && (
                    <View style={{ marginBottom: 6 }}><Text style={styles.consentLabel}>주소</Text>
                      <TextInput style={styles.profileInput} placeholder="예: 서울시 강남구 테헤란로 123"
                        value={profileInput.주소} onChangeText={t => setProfileInput(p => ({ ...p, 주소: t }))} /></View>
                  )}
                  {missingProfile.includes("생년월일") && (
                    <View><Text style={styles.consentLabel}>생년월일 (YYYY-MM-DD)</Text>
                      <TextInput style={styles.profileInput} placeholder="예: 1995-03-15" keyboardType="numbers-and-punctuation"
                        value={profileInput.생년월일} onChangeText={t => setProfileInput(p => ({ ...p, 생년월일: t }))} /></View>
                  )}
                </View>
              )}
              {/* 직원 직접입력 필드(퇴사사유·지급희망일·지급금품 체크 등) */}
              {empFields.length > 0 && (
                <View style={[styles.consentBox, { borderColor: "#c7d2fe", backgroundColor: "#eef2ff" }]}>
                  <Text style={[styles.consentTitle, { color: "#3730a3" }]}>아래 항목을 직접 작성해주세요</Text>
                  {empFields.some(f => empFieldType(f) === "check") && (
                    <Text style={[styles.consentLabel, { fontWeight: "600", marginTop: 4 }]}>지급금품 (해당 항목 체크)</Text>
                  )}
                  {empFields.map(f => {
                    const type = empFieldType(f);
                    if (type === "check") {
                      const checked = empFieldInput[f] !== "□"; // 기본 체크
                      return (
                        <TouchableOpacity key={f} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 3 }}
                          onPress={() => setEmpFieldInput(p => ({ ...p, [f]: checked ? "□" : "☑" }))}>
                          <Ionicons name={checked ? "checkbox" : "square-outline"} size={20} color="#4338ca" />
                          <Text style={{ fontSize: 14, color: "#374151" }}>{empFieldLabel(f)}</Text>
                        </TouchableOpacity>
                      );
                    }
                    return (
                      <View key={f} style={{ marginBottom: 6 }}>
                        <Text style={styles.consentLabel}>{empFieldLabel(f)}{type === "date" ? " (YYYY-MM-DD)" : ""}</Text>
                        <TextInput style={styles.profileInput}
                          placeholder={type === "date" ? "예: 2026-09-15" : `${empFieldLabel(f)} 입력`}
                          keyboardType={type === "date" ? "numbers-and-punctuation" : "default"}
                          value={empFieldInput[f] || ""} onChangeText={t => setEmpFieldInput(p => ({ ...p, [f]: t }))} />
                      </View>
                    );
                  })}
                </View>
              )}
              {signTarget && signTarget.userId !== myId && mySigUrl && !drawNewSig ? (
                /* 결재자 — 저장된 서명으로 원클릭 승인 */
                <>
                  <View style={{ flex: 1, padding: 20 }}>
                    <Text style={styles.consentLabel}>저장된 내 서명</Text>
                    <View style={{ borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, backgroundColor: "#fff", height: 120, alignItems: "center", justifyContent: "center", marginTop: 6 }}>
                      <Image source={{ uri: `${API_URL.replace(/\/api$/, "")}${mySigUrl}` }} style={{ width: 220, height: 90 }} resizeMode="contain" />
                    </View>
                    <TouchableOpacity onPress={() => setDrawNewSig(true)}>
                      <Text style={{ color: "#2563eb", fontSize: 13, marginTop: 10 }}>새로 그리기 (기존 저장 서명 교체)</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.padActions}>
                    <TouchableOpacity style={styles.padConfirm} onPress={handleApproveSaved} disabled={signing}>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <Text style={styles.padConfirmText}>저장된 서명으로 승인</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.padWrap}>
                    <SignatureScreen
                      ref={sigRef}
                      onOK={handleApproveSignature}
                      onEmpty={() => Alert.alert("알림", "서명을 입력해주세요.")}
                      descriptionText=""
                      imageType="image/png"
                      webStyle={`.m-signature-pad--footer { display: none; }
                        .m-signature-pad { box-shadow: none; border: none; }
                        body, html { width: 100%; height: 100%; }`}
                    />
                  </View>
                  {signTarget && signTarget.userId !== myId && (
                    <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingTop: 8 }}
                      onPress={() => setSaveSigDefault(v => !v)}>
                      <Ionicons name={saveSigDefault ? "checkbox" : "square-outline"} size={20} color="#2563eb" />
                      <Text style={{ fontSize: 13, color: "#374151" }}>이 서명을 저장해두고 다음 결재부터 자동 사용</Text>
                    </TouchableOpacity>
                  )}
                  <View style={styles.padActions}>
                    {consentKeys.length > 0 && (
                      <TouchableOpacity style={styles.padClear} onPress={() => setSignStep(1)}>
                        <Text style={styles.padClearText}>← 이전</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.padClear} onPress={() => sigRef.current?.clearSignature()}>
                      <Text style={styles.padClearText}>지우기</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.padConfirm} onPress={() => sigRef.current?.readSignature()}>
                      <Ionicons name="checkmark" size={18} color="#fff" />
                      <Text style={styles.padConfirmText}>승인 완료</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </>
          )}
        </View>
      </Modal>

      {/* 동의서 전문 인앱 뷰어 — 다 읽고 "확인"을 누르면 동의 화면으로 복귀 */}
      <Modal visible={!!docViewerUrl} animationType="slide" onRequestClose={() => setDocViewerUrl(null)}>
        <View style={styles.modalRoot}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>동의서 전문</Text>
            <TouchableOpacity onPress={() => setDocViewerUrl(null)}>
              <Ionicons name="close" size={26} color="#374151" />
            </TouchableOpacity>
          </View>
          {docViewerUrl && (
            <WebView
              source={{ uri: docViewerUrl }}
              style={{ flex: 1 }}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.viewerLoading}><ActivityIndicator size="large" color="#4338ca" /></View>
              )}
            />
          )}
          <View style={styles.viewerFooter}>
            <TouchableOpacity style={styles.padConfirm} onPress={() => setDocViewerUrl(null)}>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.padConfirmText}>확인 (다 읽었습니다)</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
  },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  list: {
    padding: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    borderLeftWidth: 4,
    borderLeftColor: "#2563eb",
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    flex: 1,
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  badgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  cardSubtitle: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 4,
  },
  cardDate: {
    fontSize: 12,
    color: "#9ca3af",
  },
  empty: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "#9ca3af",
  },
  approvalSection: { marginBottom: 12 },
  approvalTitle: { fontSize: 15, fontWeight: "bold", color: "#c2410c", marginBottom: 8 },
  approvalCard: {
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 8,
    padding: 14,
    marginBottom: 10,
  },
  approvalBtns: { flexDirection: "row", gap: 8, marginTop: 10 },
  viewBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: "#d1d5db", backgroundColor: "#fff",
  },
  viewBtnText: { fontSize: 13, fontWeight: "600", color: "#374151" },
  approveBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: "#2563eb",
  },
  approveBtnText: { fontSize: 13, fontWeight: "600", color: "#fff" },
  padActions: { flexDirection: "row", gap: 10, padding: 16, paddingBottom: 34, borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  padClear: { flex: 1, paddingVertical: 14, borderRadius: 8, borderWidth: 1, borderColor: "#d1d5db", alignItems: "center" },
  padClearText: { fontSize: 15, fontWeight: "600", color: "#374151" },
  padConfirm: { flex: 2, flexDirection: "row", gap: 6, paddingVertical: 14, borderRadius: 8, backgroundColor: "#2563eb", alignItems: "center", justifyContent: "center" },
  padConfirmText: { fontSize: 15, fontWeight: "600", color: "#fff" },
  viewerLoading: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  viewerFooter: { padding: 16, paddingBottom: 34, borderTopWidth: 1, borderTopColor: "#e5e7eb" },
  consentBox: { marginHorizontal: 20, marginBottom: 8, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb" },
  consentTitle: { fontSize: 12, fontWeight: "700", color: "#92400e", marginBottom: 6 },
  consentLabel: { fontSize: 12, color: "#374151" },
  consentOpt: { fontSize: 13, color: "#374151" },
  profileInput: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 6, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14, backgroundColor: "#fff", marginTop: 3 },
  viewDocBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: "#c7d2fe", backgroundColor: "#eef2ff", marginBottom: 10 },
  viewDocBtnText: { fontSize: 14, fontWeight: "600", color: "#4338ca" },
  consentNotice: { fontSize: 12, color: "#4b5563", backgroundColor: "#f9fafb", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 10, marginBottom: 10, lineHeight: 17 },
  modalRoot: { flex: 1, backgroundColor: "#fff" },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingTop: 50, paddingBottom: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: "bold", color: "#111827" },
  modalHint: { color: "#6b7280", fontSize: 13, paddingHorizontal: 20, paddingBottom: 10 },
  padWrap: { flex: 1, borderTopWidth: 1, borderTopColor: "#e5e7eb" },
});
