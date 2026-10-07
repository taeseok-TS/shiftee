import React, { useEffect, useRef, useState } from "react";
import {
  Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Image, ScrollView,
  KeyboardAvoidingView, Platform,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import DatePicker from "./DatePicker";
import * as attendance from "../services/attendance";

/**
 * 출퇴근 요청 창(2026-10-07 QA #9 #13 #15) — 출퇴근 화면에서 띄운다.
 *  · OUTSIDE    지점 밖 출퇴근: 사유(본사 방문·서점·외근·기타) + 메모. 누른 시각·위치는 자동
 *  · PHOTO      위치 인증 3번 실패 → 지점 사진 찍어 요청(원장 승인)
 *  · HQ         위치 인증 3번 실패 → 본부에 출퇴근 처리 요청(본부 승인)
 *  · MISSED_OUT 어제 퇴근 누락 → 퇴근 시각 넣어 요청
 *  · CORRECTION 출퇴근기록 수정(지각·누락) → 날짜·시각·사유
 */
export type RequestDraft = {
  kind: "OUTSIDE" | "PHOTO" | "HQ" | "MISSED_OUT" | "CORRECTION";
  action?: "IN" | "OUT";
  pressedAt?: string;                                  // 출퇴근 버튼을 누른 순간
  location?: { latitude: number; longitude: number } | null;
  workDate?: string;                                   // MISSED_OUT·CORRECTION 기본 날짜
};

const OUTSIDE_REASONS = ["본사 방문", "서점(교재 구입)", "외근", "기타"] as const;
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const pad = (n: number) => String(n).padStart(2, "0");
const hhmmOf = (iso?: string) => {
  const d = iso ? new Date(iso) : new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const todayYmd = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const TITLE: Record<RequestDraft["kind"], string> = {
  OUTSIDE: "지점 밖 출퇴근 요청",
  PHOTO: "지점 사진으로 출퇴근 요청",
  HQ: "본부에 출퇴근 처리 요청",
  MISSED_OUT: "퇴근 처리 요청",
  CORRECTION: "출퇴근기록 수정 요청",
};

export default function AttendanceRequestModal({
  draft, onClose, onDone,
}: { draft: RequestDraft | null; onClose: () => void; onDone: (message: string) => void }) {
  const [action, setAction] = useState<"IN" | "OUT">("IN");
  const [reason, setReason] = useState<string>("본사 방문");
  const [otherReason, setOtherReason] = useState("");
  const [memo, setMemo] = useState("");
  const [photo, setPhoto] = useState<{ uri: string; name: string; mimeType?: string | null } | null>(null);
  const [workDate, setWorkDate] = useState(todayYmd());
  const [inTime, setInTime] = useState("");
  const [outTime, setOutTime] = useState("");
  const [fixReason, setFixReason] = useState("");
  const [sending, setSending] = useState(false);
  const busy = useRef(false);   // 빠른 두 번 누름 방지 — state 는 다음 렌더 전까지 안 바뀐다(출퇴근 버튼과 같은 처리)

  // 창을 열 때마다 칸을 비운다
  useEffect(() => {
    if (!draft) return;
    setAction(draft.action ?? "IN");
    setReason("본사 방문");
    setOtherReason("");
    setMemo("");
    setPhoto(null);
    setWorkDate(draft.workDate ?? todayYmd());
    setInTime("");
    setOutTime("");
    setFixReason("");
  }, [draft]);

  if (!draft) return null;
  const kind = draft.kind;
  const isClock = kind === "OUTSIDE" || kind === "PHOTO" || kind === "HQ";

  const takePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("카메라 권한이 필요해요", "설정에서 큐브티의 카메라 권한을 허용해 주세요.");
        return;
      }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.6, exif: false });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      setPhoto({ uri: a.uri, name: a.fileName || `branch-${Date.now()}.jpg`, mimeType: a.mimeType || "image/jpeg" });
    } catch {
      Alert.alert("사진을 찍지 못했어요", "잠시 후 다시 시도해 주세요.");
    }
  };

  const submit = async () => {
    if (busy.current) return;
    const loc = draft.location ?? null;
    const base: Record<string, unknown> = { kind, memo: memo.trim() || undefined };
    if (isClock) {
      Object.assign(base, { action, pressedAt: draft.pressedAt, latitude: loc?.latitude, longitude: loc?.longitude });
      if (kind === "OUTSIDE") {
        const r = reason === "기타" ? otherReason.trim() : reason;
        if (!r) { Alert.alert("사유를 적어 주세요"); return; }
        base.reason = reason === "기타" ? `기타: ${r}` : r;
      }
      if (kind === "HQ" && !memo.trim()) { Alert.alert("본부에 전할 내용을 적어 주세요"); return; }
      if (kind === "PHOTO" && !photo) { Alert.alert("지점 사진을 찍어 주세요"); return; }
    } else {
      if (!fixReason.trim()) { Alert.alert("사유를 적어 주세요"); return; }
      if (inTime && !HHMM.test(inTime)) { Alert.alert("출근 시각은 09:30 처럼 넣어 주세요"); return; }
      if (outTime && !HHMM.test(outTime)) { Alert.alert("퇴근 시각은 18:30 처럼 넣어 주세요"); return; }
      if (kind === "MISSED_OUT" && !outTime) { Alert.alert("퇴근 시각을 넣어 주세요"); return; }
      if (kind === "CORRECTION" && !inTime && !outTime) { Alert.alert("고칠 출근 또는 퇴근 시각을 넣어 주세요"); return; }
      Object.assign(base, { workDate, clockIn: inTime || undefined, clockOut: outTime || undefined, reason: fixReason.trim() });
    }
    busy.current = true;
    setSending(true);
    try {
      const res = kind === "PHOTO" && photo
        ? await attendance.createPhotoRequest(photo, Object.fromEntries(
            Object.entries(base).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]),
          ))
        : await attendance.createAttendanceRequest(base);
      onDone(`요청을 보냈습니다. ${res.approverLabel} 승인 후 기록에 반영됩니다.`);
    } catch (e: any) {
      Alert.alert("보내지 못했어요", e?.response?.data?.error || "잠시 후 다시 시도해 주세요.");
    } finally {
      busy.current = false;
      setSending(false);
    }
  };

  const approver = kind === "HQ" ? "본부" : "원장(원장 본인은 본부)";

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{TITLE[kind]}</Text>

            {isClock && (
              <>
                <Text style={styles.label}>구분</Text>
                <View style={styles.row}>
                  {(["IN", "OUT"] as const).map((a) => (
                    <TouchableOpacity key={a} style={[styles.chip, action === a && styles.chipOn]} onPress={() => setAction(a)}>
                      <Text style={[styles.chipText, action === a && styles.chipTextOn]}>{a === "IN" ? "출근" : "퇴근"}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}

            {kind === "OUTSIDE" && (
              <>
                <Text style={styles.label}>사유</Text>
                <View style={styles.wrap}>
                  {OUTSIDE_REASONS.map((r) => (
                    <TouchableOpacity key={r} style={[styles.chip, reason === r && styles.chipOn]} onPress={() => setReason(r)}>
                      <Text style={[styles.chipText, reason === r && styles.chipTextOn]}>{r === "기타" ? "기타 (직접 입력)" : r}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                {reason === "기타" && (
                  <TextInput style={styles.input} value={otherReason} onChangeText={setOtherReason} maxLength={40} placeholder="사유를 적어 주세요" />
                )}
              </>
            )}

            {kind === "PHOTO" && (
              <>
                <Text style={styles.label}>지점 사진</Text>
                <Text style={styles.help}>지점 간판이나 입구가 보이게 찍어 주세요.</Text>
                {photo ? <Image source={{ uri: photo.uri }} style={styles.photo} /> : null}
                <TouchableOpacity style={styles.ghostBtn} onPress={takePhoto}>
                  <Text style={styles.ghostText}>{photo ? "다시 찍기" : "📷 사진 찍기"}</Text>
                </TouchableOpacity>
              </>
            )}

            {!isClock && (
              <>
                <Text style={styles.label}>날짜</Text>
                {kind === "MISSED_OUT"
                  ? <Text style={styles.fixed}>{workDate}</Text>
                  : <DatePicker value={workDate} onChange={setWorkDate} />}
                {kind === "CORRECTION" && (
                  <>
                    <Text style={styles.label}>출근 시각 (고칠 때만)</Text>
                    <TextInput style={styles.input} value={inTime} onChangeText={setInTime} placeholder="예: 09:30" maxLength={5} keyboardType="numbers-and-punctuation" />
                  </>
                )}
                <Text style={styles.label}>퇴근 시각{kind === "CORRECTION" ? " (고칠 때만)" : ""}</Text>
                <TextInput style={styles.input} value={outTime} onChangeText={setOutTime} placeholder="예: 18:30" maxLength={5} keyboardType="numbers-and-punctuation" />
                <Text style={styles.label}>사유</Text>
                <TextInput style={styles.input} value={fixReason} onChangeText={setFixReason} maxLength={100}
                  placeholder={kind === "MISSED_OUT" ? "예: 퇴근 버튼을 못 눌렀어요" : "예: 출근 버튼 누락, 지각 사유 등"} />
              </>
            )}

            <Text style={styles.label}>{kind === "HQ" ? "본부에 전할 내용" : "메모 (선택)"}</Text>
            <TextInput style={[styles.input, styles.memo]} value={memo} onChangeText={setMemo} maxLength={200} multiline
              placeholder={kind === "HQ" ? "예: 위치가 계속 안 잡혀요. 9:58 지점 도착" : "예: 10시 본사 교육 참석"} />

            <Text style={styles.help}>
              {isClock ? `요청 시각 ${hhmmOf(draft.pressedAt)} · 위치 ${draft.location ? "자동 기록" : "없음"} · ` : ""}승인: {approver}
            </Text>

            <TouchableOpacity style={[styles.sendBtn, sending && { opacity: 0.6 }]} onPress={submit} disabled={sending}>
              {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendText}>요청 보내기</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} disabled={sending}>
              <Text style={styles.cancelText}>닫기</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  sheet: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 20, maxHeight: "90%" },
  title: { fontSize: 19, fontWeight: "700", color: "#111827", marginBottom: 8 },
  label: { fontSize: 13, color: "#6b7280", marginTop: 14, marginBottom: 6 },
  row: { flexDirection: "row", gap: 8 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  chipOn: { borderColor: "#1d4ed8", backgroundColor: "#eff6ff" },
  chipText: { fontSize: 15, color: "#374151" },
  chipTextOn: { color: "#1d4ed8", fontWeight: "600" },
  input: { borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, color: "#111827", marginTop: 6 },
  memo: { minHeight: 64, textAlignVertical: "top" },
  fixed: { fontSize: 16, color: "#111827", paddingVertical: 6 },
  help: { fontSize: 12, color: "#9ca3af", marginTop: 12 },
  photo: { width: "100%", height: 200, borderRadius: 10, marginVertical: 8, backgroundColor: "#f3f4f6" },
  ghostBtn: { borderWidth: 1, borderColor: "#1d4ed8", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 6 },
  ghostText: { color: "#1d4ed8", fontWeight: "600", fontSize: 15 },
  sendBtn: { backgroundColor: "#1d4ed8", borderRadius: 12, paddingVertical: 15, alignItems: "center", marginTop: 18 },
  sendText: { color: "#fff", fontSize: 17, fontWeight: "700" },
  cancelBtn: { paddingVertical: 12, alignItems: "center" },
  cancelText: { color: "#6b7280", fontSize: 15 },
});
