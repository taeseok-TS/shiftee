import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
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

  useEffect(() => {
    getLocation();
  }, []);

  // 화면에 들어올 때마다 오늘 출퇴근 상태를 다시 불러온다
  useFocusEffect(
    useCallback(() => {
      loadStatus();
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

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      }
    } catch (error) {
      console.error("❌ Failed to get location:", error);
    }
  };

  const handlePress = async () => {
    if (phase === "DONE" || phase === "LOADING") return;
    if (!location) {
      Alert.alert("위치 필요", "위치 정보를 가져올 수 없습니다. 휴대폰 GPS(위치)를 켜고 다시 시도해주세요.");
      getLocation();
      return;
    }

    setIsLoading(true);
    try {
      if (phase === "IN") {
        await attendance.clockOut(location.latitude, location.longitude);
        Alert.alert("성공", "퇴근 기록이 저장되었습니다");
        setPhase("DONE");
      } else {
        await attendance.clockIn(location.latitude, location.longitude);
        Alert.alert("성공", "출근 기록이 저장되었습니다");
        setPhase("IN");
      }
    } catch (error: any) {
      // 서버 메시지(지오펜스 이탈 등)를 그대로 노출
      Alert.alert("처리 불가", error?.response?.data?.error || "출퇴근 기록 중 오류가 발생했습니다");
      loadStatus(); // 상태 동기화
    } finally {
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
