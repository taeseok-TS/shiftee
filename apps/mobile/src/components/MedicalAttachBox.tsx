import React, { useCallback, useEffect, useState } from "react";
import { View, Text, TouchableOpacity, ActivityIndicator, Alert, Linking, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { getMedical, uploadMedical, medicalLink, type MedicalInfo } from "../services/contractMedical";

// 임신기 신청서 진단서 첨부(#242) — 대상 서류가 아니면 아무것도 그리지 않는다(서버가 required:false)
//  · 본부·본인: 첨부를 누르면 기기 브라우저로 연다(2026-11-05 디렉터 「앱에서도 열리게」 — 10분 티켓 주소)
//  · signer: 근로자 본인 서명 — 올리기 + 「같은 임신으로 다시 신청」 체크. 서명 단추 막기는 부모가 onStatus 로
//  · 결재자(원장 등): 「진단서 첨부됨」 표시만 — 서버가 파일·이름을 주지 않는다
export type MedicalStatus = { required: boolean; count: number };

export default function MedicalAttachBox({ contractId, signer = false, reapply, onReapply, onStatus }: {
  contractId: string;
  signer?: boolean;
  reapply?: boolean;
  onReapply?: (v: boolean) => void;
  onStatus?: (s: MedicalStatus) => void;
}) {
  const [info, setInfo] = useState<MedicalInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try { setInfo(await getMedical(contractId)); } catch { setInfo({ required: false }); }
  }, [contractId]);
  useEffect(() => { load(); }, [load]);
  const count = info && info.required ? (info.attachments ? info.attachments.length : info.count ?? 0) : 0;
  useEffect(() => { if (info) onStatus?.({ required: info.required, count }); }, [info, count, onStatus]);
  if (!info || !info.required) return null;

  const send = async (f: { uri: string; name: string; mimeType?: string | null }) => {
    setBusy(true);
    try { await uploadMedical(contractId, f); }
    catch (e: any) { Alert.alert("진단서", e?.message || "올리지 못했습니다."); }
    finally { setBusy(false); load(); }
  };
  const open = async (attId: string) => {
    try { await Linking.openURL(await medicalLink(contractId, attId)); }
    catch (e: any) { Alert.alert("진단서", e?.response?.data?.error || "진단서를 열지 못했습니다."); }
  };
  const pickPhoto = async () => {
    if (busy) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8 });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    // 앨범이 JPEG 로 건네면서 이름은 .HEIC 로 둘 때가 있다 — 서버는 내용으로 형식을 본다
    await send({ uri: a.uri, name: a.fileName || `진단서_${Date.now()}.jpg`, mimeType: a.mimeType || "image/jpeg" });
  };
  const pickFile = async () => {
    if (busy) return;
    const r = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, type: ["application/pdf", "image/*"] });
    if (r.canceled || !r.assets?.length) return;
    const a = r.assets[0];
    if ((a.size ?? 0) > 10 * 1024 * 1024) { Alert.alert("진단서", "파일당 10MB 이하만 올릴 수 있습니다."); return; }
    await send({ uri: a.uri, name: a.name, mimeType: a.mimeType });
  };

  // 결재자 — 표시만
  if (!info.attachments) {
    return (
      <View style={s.box}>
        <Text style={s.title}>진단서</Text>
        <Text style={{ fontSize: 13, color: count ? "#15803d" : "#92400e" }}>
          {count ? `✓ 진단서 첨부됨${count > 1 ? ` (${count}건)` : ""}` : info.reapply ? "진단서 없음 — 같은 임신 재신청" : "아직 첨부되지 않음(근로자 서명 때 올립니다)"}
        </Text>
        <Text style={s.hint}>진단서 내용은 본부·본인·재무팀만 볼 수 있습니다.</Text>
      </View>
    );
  }
  return (
    <View style={s.box}>
      <Text style={s.title}>진단서 첨부{signer ? " *" : ""}</Text>
      <Text style={s.hint}>임신 사실·주수를 확인할 수 있는 진단서(의사 소견서)를 올려 주세요. 본부·본인·재무팀만 볼 수 있습니다(원장님께는 「첨부됨」만 보입니다).</Text>
      {info.attachments.map((a) => (
        <TouchableOpacity key={a.attId} style={s.row} onPress={() => open(a.attId)}>
          <Ionicons name="document-attach-outline" size={16} color="#4338ca" />
          <Text style={{ flex: 1, fontSize: 13, color: "#4338ca" }} numberOfLines={1}>{a.name}</Text>
          {a.byAdmin && <Text style={{ fontSize: 12, color: "#9ca3af" }}>본부</Text>}
          <Text style={{ fontSize: 12, color: "#4338ca", fontWeight: "600" }}>열기</Text>
        </TouchableOpacity>
      ))}
      {info.canUpload && (
        busy ? <ActivityIndicator style={{ marginVertical: 8 }} color="#b45309" /> : (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
            <TouchableOpacity style={s.btn} onPress={pickPhoto}><Text style={s.btnText}>+ 사진에서</Text></TouchableOpacity>
            <TouchableOpacity style={s.btn} onPress={pickFile}><Text style={s.btnText}>+ 파일(PDF)에서</Text></TouchableOpacity>
          </View>
        )
      )}
      {signer && !info.attachments.length && (
        <TouchableOpacity style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 8 }} onPress={() => onReapply?.(!reapply)}>
          <Ionicons name={reapply ? "checkbox" : "square-outline"} size={20} color="#4338ca" />
          <Text style={{ flex: 1, fontSize: 13, color: "#374151" }}>같은 임신으로 다시 신청합니다(진단서는 앞서 제출했습니다)</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", borderRadius: 10, padding: 12, marginBottom: 10 },
  title: { fontSize: 14, fontWeight: "700", color: "#111827", marginBottom: 4 },
  hint: { fontSize: 12, color: "#6b7280", marginBottom: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#fff", borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, marginTop: 4 },
  btn: { flex: 1, borderWidth: 1, borderStyle: "dashed", borderColor: "#f59e0b", borderRadius: 8, paddingVertical: 8, alignItems: "center", backgroundColor: "#fff" },
  btnText: { fontSize: 13, fontWeight: "600", color: "#92400e" },
});
