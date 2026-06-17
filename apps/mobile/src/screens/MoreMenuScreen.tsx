import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

const MENU: { route: string; label: string; icon: keyof typeof Ionicons.glyphMap; color: string }[] = [
  { route: "Contracts", label: "계약서", icon: "document-text-outline", color: "#2563eb" },
  { route: "Leave", label: "휴가", icon: "umbrella-outline", color: "#10b981" },
  { route: "Settings", label: "설정", icon: "settings-outline", color: "#6b7280" },
];

export default function MoreMenuScreen() {
  const navigation = useNavigation<any>();
  return (
    <ScrollView style={styles.container}>
      <View style={styles.group}>
        {MENU.map((m) => (
          <TouchableOpacity key={m.route} style={styles.row} onPress={() => navigation.navigate(m.route)}>
            <Ionicons name={m.icon} size={22} color={m.color} />
            <Text style={styles.label}>{m.label}</Text>
            <Ionicons name="chevron-forward" size={20} color="#d1d5db" />
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  group: { backgroundColor: "#fff", marginTop: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  label: { flex: 1, fontSize: 16, color: "#111827" },
});
