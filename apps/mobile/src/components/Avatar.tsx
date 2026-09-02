import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { fileUri } from "../services/work";

// 이름 기반 이니셜 아바타(색상은 이름 해시로 고정). uri가 있으면 프로필 사진 표시.
const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#6366f1", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

export default function Avatar({ name, size = 36, uri }: { name: string; size?: number; uri?: string | null }) {
  if (uri) {
    // fileUri 를 거친다 - 지금 avatars 는 게이트 밖이라 티켓이 안 붙지만,
    // 나중에 게이트에 넣으면 앱 재배포 없이 따라 붙는다 (2026-09-02 work 사고 재발 방지).
    const src = fileUri(uri);
    return <Image source={{ uri: src }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: "#e5e7eb" }} />;
  }
  const initial = (name || "?").trim().charAt(0) || "?";
  return (
    <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: colorFor(name || "?") }]}>
      <Text style={[styles.text, { fontSize: size * 0.42 }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: { alignItems: "center", justifyContent: "center" },
  text: { color: "#fff", fontWeight: "700" },
});
