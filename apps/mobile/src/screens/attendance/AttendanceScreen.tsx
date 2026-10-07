import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  RefreshControl,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";
import * as attendance from "../../services/attendance";
import AttendanceRequestModal, { RequestDraft } from "../../components/AttendanceRequestModal";

type Phase = "LOADING" | "OUT" | "IN" | "DONE";
type FailReason = "permission" | "services" | "timeout" | "outside" | "nolocation";

// 실패 이유별 안내(2026-10-07 #13) — 반경 밖 · 위치 권한 꺼짐 · 휴대폰 위치 꺼짐 · 위치 확인 지연
const FAIL_TEXT: Record<FailReason, string> = {
  permission: "위치 권한이 꺼져 있어요. 설정에서 큐브티 위치 권한을 「앱 사용 중 허용」으로 바꿔 주세요.",
  services: "휴대폰 위치(GPS)가 꺼져 있어요. 휴대폰 설정에서 위치 서비스를 켜 주세요.",
  timeout: "위치 확인이 늦어지고 있어요. 창가나 건물 입구 쪽에서 다시 눌러 주세요.",
  outside: "지점 반경 밖이에요.",
  nolocation: "위치 정보가 오지 않았어요. 위치 권한과 GPS 를 확인해 주세요.",
};

const STATUS_LABEL: Record<string, string> = { PENDING: "승인 대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소" };
const STATUS_COLOR: Record<string, string> = { PENDING: "#d97706", APPROVED: "#059669", REJECTED: "#dc2626", CANCELLED: "#9ca3af" };

export default function AttendanceScreen() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [phase, setPhase] = useState<Phase>("LOADING");
  const [pending, setPending] = useState<{ in: boolean; out: boolean }>({ in: false, out: false });
  const [isLoading, setIsLoading] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  // 같은 출근(또는 퇴근)에서 연속 실패 횟수 — 3번이면 사진·본부 요청을 안내한다(본부 답변 #11)
  const [fail, setFail] = useState<{ count: number; reason: FailReason; detail?: string; pressedAt: string } | null>(null);
  const [missed, setMissed] = useState<{ date: string; clockIn: string } | null>(null);
  const [requests, setRequests] = useState<attendance.AttendanceRequestRow[]>([]);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadStatus = async () => {
    try {
      const s = await attendance.getTodayStatus();
      // 출근 요청이 승인 대기 중이면 퇴근은 찍을 수 있다(본부 답변 #10)
      setPhase(s.clockedOut || s.pendingOut || s.pendingInClockedOut ? "DONE" : s.clockedIn || s.pendingIn ? "IN" : "OUT");
      setPending({ in: !!s.pendingIn && !s.clockedIn, out: !!s.pendingOut });
    } catch {
      setPhase("OUT"); // 조회 실패 시 기본 출근 가능 상태
    }
  };
  const loadExtras = async () => {
    attendance.getMissedOut().then(setMissed).catch(() => {});
    attendance.getMyAttendanceRequests().then((r) => setRequests(r.slice(0, 10))).catch(() => {});
  };

  // 화면에 들어올 때마다 오늘 출퇴근 상태와 위치를 다시 불러온다(위치는 표시용 — 출퇴근은 누르는 순간 새로 잰다)
  useFocusEffect(
    useCallback(() => {
      loadStatus();
      loadExtras();
      refreshShownLocation();
    }, [])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadStatus(), loadExtras()]);
    setRefreshing(false);
  };

  // 출근→퇴근으로 바뀌면 실패 횟수는 새로 센다
  const lastPhase = useRef<Phase>("LOADING");
  useEffect(() => {
    if (lastPhase.current !== phase) setFail(null);
    lastPhase.current = phase;
  }, [phase]);

  // 위치를 **누르는 순간마다 새로** 잰다(2026-10-06). 종전에는 화면을 처음 열 때 한 번만 재서,
  // 지점 밖에서 앱을 열었다가 걸어 들어와 누르면 옛 위치로 계속 「반경 밖」이 됐다(하단 탭 화면은 계속 살아 있다).
  type Fix = { ok: true; latitude: number; longitude: number } | { ok: false; reason: "permission" | "services" | "timeout" };
  const measure = async (): Promise<Fix> => {
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== "granted") perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") return { ok: false, reason: "permission" };
      if (!(await Location.hasServicesEnabledAsync())) return { ok: false, reason: "services" };
      const fresh = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((r) => setTimeout(() => r(null), 12000)),
      ]);
      if (fresh) return { ok: true, latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
      // 새 위치가 늦으면 1분 안에 잰 위치까지는 쓴다(실내에서 GPS 가 늦게 잡히는 경우)
      const last = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
      if (last) return { ok: true, latitude: last.coords.latitude, longitude: last.coords.longitude };
      return { ok: false, reason: "timeout" };
    } catch {
      return { ok: false, reason: "timeout" };
    }
  };

  const refreshShownLocation = async () => {
    const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
    if (perm?.status !== "granted") return; // 화면 들어올 때는 권한 창을 띄우지 않는다
    const f = await measure();
    if (f.ok) setLocation({ latitude: f.latitude, longitude: f.longitude });
  };

  const recordFail = (reason: FailReason, pressedAt: string, detail?: string) =>
    setFail((p) => ({ count: (p?.count ?? 0) + 1, reason, detail, pressedAt }));

  const busy = useRef(false);   // 빠른 두 번 탭 방지(검증관 P4) — state 는 다음 렌더 전까지 바뀌지 않는다
  const handlePress = async () => {
    if (phase === "DONE" || phase === "LOADING" || busy.current) return;
    busy.current = true;
    setIsLoading(true);
    const pressedAt = new Date().toISOString();   // 요청으로 넘어가면 이 시각으로 기록된다(본부 답변 #10)
    try {
      const f = await measure();
      if (!f.ok) {
        recordFail(f.reason, pressedAt);
        if (f.reason === "permission") {
          Alert.alert("위치 권한이 꺼져 있어요", FAIL_TEXT.permission, [
            { text: "닫기", style: "cancel" },
            { text: "설정 열기", onPress: () => Linking.openSettings().catch(() => {}) },
          ]);
        }
        return;
      }
      setLocation({ latitude: f.latitude, longitude: f.longitude });
      if (phase === "IN") {
        const r = await attendance.clockOut(f.latitude, f.longitude);
        // 출근 요청 승인 대기 중이면 퇴근은 요청에 담겨, 승인될 때 함께 기록된다
        Alert.alert("성공", r?.pendingIn ? r.message || "퇴근을 남겼습니다. 출근 요청이 승인되면 함께 기록됩니다." : "퇴근 기록이 저장되었습니다");
        setPhase("DONE");
      } else {
        await attendance.clockIn(f.latitude, f.longitude);
        Alert.alert("성공", "출근 기록이 저장되었습니다");
        setPhase("IN");
      }
      setFail(null);
    } catch (error: any) {
      const d = error?.response?.data;
      if (d?.outsideGeofence) {
        recordFail("outside", pressedAt, d?.distance != null ? `지점에서 약 ${d.distance}m 떨어져 있어요(허용 ${d.radius}m).` : undefined);
      } else if (d?.needsLocation) {
        recordFail("nolocation", pressedAt);
      } else {
        // 서버 메시지(주말 사전승인·기기 등)를 그대로 노출
        Alert.alert("처리 불가", d?.error || "출퇴근 기록 중 오류가 발생했습니다");
      }
      loadStatus(); // 상태 동기화
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  const action: "IN" | "OUT" = phase === "IN" ? "OUT" : "IN";
  const word = action === "IN" ? "출근" : "퇴근";
  const openClockRequest = (kind: "OUTSIDE" | "PHOTO" | "HQ") =>
    setDraft({ kind, action, pressedAt: fail?.pressedAt ?? new Date().toISOString(), location });

  const onRequestDone = (message: string) => {
    setDraft(null);
    setFail(null);
    Alert.alert("요청 완료", message);
    loadStatus();
    loadExtras();
  };

  const cancelRequest = (r: attendance.AttendanceRequestRow) => {
    Alert.alert("요청 취소", `${r.kindLabel} 요청을 거둘까요?`, [
      { text: "아니요", style: "cancel" },
      {
        text: "취소하기", style: "destructive",
        onPress: async () => {
          try {
            await attendance.cancelAttendanceRequest(r.id);
            loadStatus();
            loadExtras();
          } catch (e: any) {
            Alert.alert("취소하지 못했어요", e?.response?.data?.error || "잠시 후 다시 시도해 주세요.");
          }
        },
      },
    ]);
  };

  const timeString = currentTime.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateString = currentTime.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

  const statusUi =
    phase === "IN"
      ? { dot: pending.in ? "#d97706" : "#10b981", text: pending.in ? "근무 중 · 출근 요청 승인 대기" : "근무 중" }
      : phase === "DONE"
      ? { dot: "#9ca3af", text: pending.out ? "퇴근 요청 승인 대기" : pending.in ? "퇴근 완료 · 출근 요청 승인 대기" : "퇴근 완료" }
      : { dot: "#ef4444", text: "출근 전" };

  const buttonLabel = phase === "IN" ? "퇴근" : phase === "DONE" ? "오늘 근무 완료" : "출근";
  const buttonColor = phase === "IN" ? "#ef4444" : phase === "DONE" ? "#9ca3af" : "#10b981";
  const buttonDisabled = isLoading || phase === "DONE" || phase === "LOADING";
  const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <View style={styles.timeCard}>
        <Text style={styles.date}>{dateString}</Text>
        <Text style={styles.time}>{timeString}</Text>
      </View>

      {/* 어제 퇴근 누락 안내(#15) */}
      {missed && (
        <View style={styles.warnCard}>
          <Text style={styles.warnTitle}>{md(missed.date)} 퇴근 기록이 없어요</Text>
          <Text style={styles.warnText}>퇴근 시각을 넣어 요청해 주세요.</Text>
          <TouchableOpacity style={styles.outlineBtn} onPress={() => setDraft({ kind: "MISSED_OUT", workDate: missed.date })}>
            <Text style={styles.outlineText}>퇴근 처리 요청하기</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.statusCard}>
        <View style={[styles.statusDot, { backgroundColor: statusUi.dot }]} />
        <Text style={styles.statusText}>{statusUi.text}</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: buttonColor }, buttonDisabled && styles.buttonDisabled]}
        onPress={handlePress}
        disabled={buttonDisabled}
      >
        {isLoading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{buttonLabel}</Text>}
      </TouchableOpacity>

      {/* 위치 인증 실패 안내(#13) — 반경 밖이면 지점 밖 요청, 3번 실패하면 사진·본부 요청 */}
      {fail && phase !== "DONE" && (
        <View style={styles.failCard}>
          <Text style={styles.failTitle}>{word} 위치를 확인하지 못했어요 ({fail.count}번째)</Text>
          <Text style={styles.failText}>{FAIL_TEXT[fail.reason]}{fail.detail ? ` ${fail.detail}` : ""}</Text>
          {fail.reason === "outside" && (
            <>
              <Text style={styles.failText}>본사·서점 등 지점 밖이라면 요청으로 {word}해 주세요.</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => openClockRequest("OUTSIDE")}>
                <Text style={styles.primaryText}>지점 밖 {word} 요청하기 →</Text>
              </TouchableOpacity>
            </>
          )}
          {fail.count >= 3 && (
            <>
              <Text style={styles.failSub}>다른 방법으로 {word}하기</Text>
              <TouchableOpacity style={styles.primaryBtn} onPress={() => openClockRequest("PHOTO")}>
                <Text style={styles.primaryText}>📷 지점 사진 올려 {word} 요청 (원장 승인)</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.outlineBtn} onPress={() => openClockRequest("HQ")}>
                <Text style={styles.outlineText}>본부에 {word} 처리 요청</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {location && (
        <Text style={styles.location}>
          위치: {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
        </Text>
      )}

      {/* 내 출퇴근 요청 */}
      {requests.length > 0 && (
        <View style={styles.listCard}>
          <Text style={styles.listTitle}>내 출퇴근 요청</Text>
          {requests.map((r) => (
            <View key={r.id} style={styles.reqRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.reqMain}>{r.summary}</Text>
                <Text style={styles.reqSub}>
                  <Text style={{ color: STATUS_COLOR[r.status] }}>{STATUS_LABEL[r.status] ?? r.status}</Text>
                  {r.status === "PENDING" ? ` · 승인: ${r.approverLabel}` : r.decidedByName ? ` · ${r.decidedByName}` : ""}
                  {r.status === "REJECTED" && r.rejectReason ? ` · ${r.rejectReason}` : ""}
                </Text>
              </View>
              {r.status === "PENDING" && (
                <TouchableOpacity onPress={() => cancelRequest(r)}>
                  <Text style={styles.cancelLink}>취소</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.fixLink} onPress={() => setDraft({ kind: "CORRECTION" })}>
        <Text style={styles.fixLinkText}>출퇴근기록 수정 요청 (지각·누락)</Text>
      </TouchableOpacity>

      <AttendanceRequestModal draft={draft} onClose={() => setDraft(null)} onDone={onRequestDone} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb" },
  content: { padding: 20, paddingTop: 28, paddingBottom: 40 },
  timeCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 30,
    marginBottom: 20,
    alignItems: "center",
    borderLeftWidth: 4,
    borderLeftColor: "#2563eb",
  },
  date: { fontSize: 16, color: "#6b7280", marginBottom: 12 },
  time: { fontSize: 48, fontWeight: "700", color: "#1f2937" },
  statusCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: { width: 16, height: 16, borderRadius: 8, marginRight: 12 },
  statusText: { fontSize: 18, fontWeight: "600", color: "#1f2937", flexShrink: 1 },
  button: { paddingVertical: 16, borderRadius: 12, alignItems: "center", marginBottom: 16 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  location: { textAlign: "center", fontSize: 12, color: "#9ca3af", marginBottom: 16 },
  warnCard: { backgroundColor: "#fffbeb", borderColor: "#fcd34d", borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 20 },
  warnTitle: { fontSize: 16, fontWeight: "700", color: "#b45309" },
  warnText: { fontSize: 14, color: "#92400e", marginTop: 4 },
  failCard: { backgroundColor: "#fef2f2", borderColor: "#fca5a5", borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 16 },
  failTitle: { fontSize: 16, fontWeight: "700", color: "#b91c1c" },
  failText: { fontSize: 14, color: "#7f1d1d", marginTop: 6 },
  failSub: { fontSize: 14, fontWeight: "700", color: "#111827", marginTop: 14 },
  primaryBtn: { backgroundColor: "#1d4ed8", borderRadius: 10, paddingVertical: 13, alignItems: "center", marginTop: 10 },
  primaryText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  outlineBtn: { backgroundColor: "#fff", borderWidth: 1, borderColor: "#d1d5db", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 10 },
  outlineText: { color: "#111827", fontSize: 15, fontWeight: "600" },
  listCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12 },
  listTitle: { fontSize: 15, fontWeight: "700", color: "#111827", marginBottom: 6 },
  reqRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e5e7eb" },
  reqMain: { fontSize: 14, color: "#111827" },
  reqSub: { fontSize: 12, color: "#6b7280", marginTop: 2 },
  cancelLink: { color: "#dc2626", fontSize: 14, paddingHorizontal: 8, paddingVertical: 4 },
  fixLink: { alignItems: "center", paddingVertical: 12 },
  fixLinkText: { color: "#2563eb", fontSize: 14, textDecorationLine: "underline" },
});
