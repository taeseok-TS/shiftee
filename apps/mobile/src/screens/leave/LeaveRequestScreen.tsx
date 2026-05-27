import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { LeaveType } from "@shiftee/api";
import * as api from "../../services/api";

export default function LeaveRequestScreen() {
  const [leaveType, setLeaveType] = useState<LeaveType>("ANNUAL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const leaveTypes: Array<{ value: LeaveType; label: string }> = [
    { value: "ANNUAL", label: "연차" },
    { value: "SICK", label: "병가" },
    { value: "PERSONAL", label: "개인휴가" },
  ];

  const handleSubmit = async () => {
    if (!startDate || !endDate) {
      Alert.alert("오류", "시작일과 종료일을 입력해주세요");
      return;
    }

    setIsLoading(true);
    try {
      await api.createLeaveRequest({
        type: leaveType,
        startDate,
        endDate,
        reason,
      });
      Alert.alert("성공", "휴가 신청이 완료되었습니다");
      setLeaveType("ANNUAL");
      setStartDate("");
      setEndDate("");
      setReason("");
    } catch (error: any) {
      Alert.alert("오류", error.response?.data?.error || "휴가 신청 중 오류가 발생했습니다");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.label}>휴가 유형</Text>
        <View style={styles.typeButtons}>
          {leaveTypes.map((type) => (
            <TouchableOpacity
              key={type.value}
              style={[
                styles.typeButton,
                leaveType === type.value && styles.typeButtonActive,
              ]}
              onPress={() => setLeaveType(type.value)}
            >
              <Text
                style={[
                  styles.typeButtonText,
                  leaveType === type.value && styles.typeButtonTextActive,
                ]}
              >
                {type.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>시작일</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          value={startDate}
          onChangeText={setStartDate}
          editable={!isLoading}
        />

        <Text style={styles.label}>종료일</Text>
        <TextInput
          style={styles.input}
          placeholder="YYYY-MM-DD"
          value={endDate}
          onChangeText={setEndDate}
          editable={!isLoading}
        />

        <Text style={styles.label}>신청 사유</Text>
        <TextInput
          style={[styles.input, styles.textArea]}
          placeholder="(선택사항)"
          value={reason}
          onChangeText={setReason}
          multiline
          editable={!isLoading}
        />

        <TouchableOpacity
          style={[styles.submitButton, isLoading && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>신청하기</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f9fafb",
    padding: 16,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
    marginTop: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 8,
    marginTop: 16,
  },
  typeButtons: {
    flexDirection: "row",
    gap: 8,
  },
  typeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    alignItems: "center",
  },
  typeButtonActive: {
    backgroundColor: "#2563eb",
    borderColor: "#2563eb",
  },
  typeButtonText: {
    fontSize: 14,
    color: "#6b7280",
  },
  typeButtonTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#1f2937",
    marginBottom: 12,
  },
  textArea: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  submitButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 20,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  submitButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
