import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import * as Location from "expo-location";
import * as attendance from "../../services/attendance";

type Phase = "LOADING" | "OUT" | "IN" | "DONE";

export default function AttendanceScreen() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [phase, setPhase] = useState<Phase>("LOADING");
  const [isLoading, setIsLoading] = useState(false);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // 화면에 들어올 때마다 오늘 출퇴근 상태와 위치를 다시 불러온다(위치는 표시용 — 출퇴근은 누르는 순간 새로 잰다)
  useFocusEffect(
    useCallback(() => {
      loadStatus();
      refreshShownLocation();
    }, [])
  );

  const loadStatus = async () => {
    try {
      const s = await attendance.getTodayStatus();
      setPhase(s.clockedOut ? "DONE" : s.clockedIn ? "IN" : "OUT");
    } catch {
      setPhase("OUT"); // 조회 실패 시 기본 출근 가능 상태
    }
  };

  // 위치를 **누르는 순간마다 새로** 잰다(2026-10-06). 종전에는 화면을 처음 열 때 한 번만 재서,
  // 지점 밖에서 앱을 열었다가 걸어 들어와 누르면 옛 위치로 계속 「반경 밖」이 됐다(하단 탭 화면은 계속 살아 있다).
  // 실패하면 이유를 나눠 알려 준다: 권한 꺼짐 / 휴대폰 위치(GPS) 꺼짐 / 위치 확인 지연.
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

  const explainFailure = (reason: "permission" | "services" | "timeout") => {
    if (reason === "permission") {
      Alert.alert("위치 권한이 꺼져 있어요", "출퇴근은 지점 위치 확인이 필요합니다. 설정에서 큐브티의 위치 권한을 「앱 사용 중 허용」으로 바꿔 주세요.", [
        { text: "닫기", style: "cancel" },
        { text: "설정 열기", onPress: () => Linking.openSettings().catch(() => {}) },
      ]);
    } else if (reason === "services") {
      Alert.alert("휴대폰 위치(GPS)가 꺼져 있어요", "휴대폰 설정에서 위치 서비스를 켜고 다시 눌러 주세요.");
    } else {
      Alert.alert("위치 확인이 늦어지고 있어요", "창가나 건물 입구 쪽에서 잠시 후 다시 눌러 주세요.");
    }
  };

  const busy = useRef(false);   // 빠른 두 번 탭 방지(검증관 P4) — state 는 다음 렌더 전까지 바뀌지 않는다
  const handlePress = async () => {
    if (phase === "DONE" || phase === "LOADING" || busy.current) return;
    busy.current = true;
    setIsLoading(true);
    try {
      const f = await measure();
      if (!f.ok) {
        explainFailure(f.reason);
        return;
      }
      setLocation({ latitude: f.latitude, longitude: f.longitude });
      if (phase === "IN") {
        await attendance.clockOut(f.latitude, f.longitude);
        Alert.alert("성공", "퇴근 기록이 저장되었습니다");
        setPhase("DONE");
      } else {
        await attendance.clockIn(f.latitude, f.longitude);
        Alert.alert("성공", "출근 기록이 저장되었습니다");
        setPhase("IN");
      }
    } catch (error: any) {
      // 서버 메시지(지오펜스 이탈 등)를 그대로 노출
      Alert.alert("처리 불가", error?.response?.data?.error || "출퇴근 기록 중 오류가 발생했습니다");
      loadStatus(); // 상태 동기화
    } finally {
      busy.current = false;
      setIsLoading(false);
    }
  };

  const timeString = currentTime.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const dateString = currentTime.toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });

  const statusUi =
    phase === "IN"
      ? { dot: "#10b981", text: "근무 중" }
      : phase === "DONE"
      ? { dot: "#9ca3af", text: "퇴근 완료" }
      : { dot: "#ef4444", text: "출근 전" };

  const buttonLabel = phase === "IN" ? "퇴근" : phase === "DONE" ? "오늘 근무 완료" : "출근";
  const buttonColor = phase === "IN" ? "#ef4444" : phase === "DONE" ? "#9ca3af" : "#10b981";
  const buttonDisabled = isLoading || phase === "DONE" || phase === "LOADING";

  return (
    <View style={styles.container}>
      <View style={styles.timeCard}>
        <Text style={styles.date}>{dateString}</Text>
        <Text style={styles.time}>{timeString}</Text>
      </View>

      <View style={styles.statusCard}>
        <View style={[styles.statusDot, { backgroundColor: statusUi.dot }]} />
        <Text style={styles.statusText}>{statusUi.text}</Text>
      </View>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: buttonColor }, buttonDisabled && styles.buttonDisabled]}
        onPress={handlePress}
        disabled={buttonDisabled}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{buttonLabel}</Text>
        )}
      </TouchableOpacity>

      {location && (
        <Text style={styles.location}>
          위치: {location.latitude.toFixed(4)}, {location.longitude.toFixed(4)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f9fafb", padding: 20, justifyContent: "center" },
  timeCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 30,
    marginBottom: 30,
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
    marginBottom: 30,
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: { width: 16, height: 16, borderRadius: 8, marginRight: 12 },
  statusText: { fontSize: 18, fontWeight: "600", color: "#1f2937" },
  button: { paddingVertical: 16, borderRadius: 12, alignItems: "center", marginBottom: 20 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 18, fontWeight: "600" },
  location: { textAlign: "center", fontSize: 12, color: "#9ca3af" },
});
