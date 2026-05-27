import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import * as Location from "expo-location";
import { Attendance } from "@shiftee/api";
import * as api from "../../services/api";

export default function AttendanceScreen() {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    getLocation();
  }, []);

  const getLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        const loc = await Location.getCurrentPositionAsync({});
        setLocation({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      }
    } catch (error) {
      console.error("❌ Failed to get location:", error);
    }
  };

  const handleClockToggle = async () => {
    if (!location) {
      Alert.alert("오류", "위치 정보를 가져올 수 없습니다");
      return;
    }

    setIsLoading(true);
    try {
      if (isClockedIn) {
        await api.clockOut(location.latitude, location.longitude);
        Alert.alert("성공", "퇴근 기록이 저장되었습니다");
        setIsClockedIn(false);
      } else {
        await api.clockIn(location.latitude, location.longitude);
        Alert.alert("성공", "출근 기록이 저장되었습니다");
        setIsClockedIn(true);
      }
    } catch (error) {
      Alert.alert("오류", "출퇴근 기록 중 오류가 발생했습니다");
    } finally {
      setIsLoading(false);
    }
  };

  const timeString = currentTime.toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const dateString = currentTime.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <View style={styles.container}>
      <View style={styles.timeCard}>
        <Text style={styles.date}>{dateString}</Text>
        <Text style={styles.time}>{timeString}</Text>
      </View>

      <View style={styles.statusCard}>
        <View style={[styles.statusDot, { backgroundColor: isClockedIn ? "#10b981" : "#ef4444" }]} />
        <Text style={styles.statusText}>
          {isClockedIn ? "근무 중" : "퇴근"}
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.button,
          { backgroundColor: isClockedIn ? "#ef4444" : "#10b981" },
          isLoading && styles.buttonDisabled,
        ]}
        onPress={handleClockToggle}
        disabled={isLoading}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {isClockedIn ? "퇴근" : "출근"}
          </Text>
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
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    padding: 20,
    justifyContent: "center",
  },
  timeCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 30,
    marginBottom: 30,
    alignItems: "center",
    borderLeftWidth: 4,
    borderLeftColor: "#2563eb",
  },
  date: {
    fontSize: 16,
    color: "#6b7280",
    marginBottom: 12,
  },
  time: {
    fontSize: 48,
    fontWeight: "700",
    color: "#1f2937",
  },
  statusCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginBottom: 30,
    flexDirection: "row",
    alignItems: "center",
  },
  statusDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    marginRight: 12,
  },
  statusText: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1f2937",
  },
  button: {
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: "center",
    marginBottom: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  location: {
    textAlign: "center",
    fontSize: 12,
    color: "#9ca3af",
  },
});
