import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Contract } from "@shiftee/api";
import * as api from "../../services/api";

export default function ContractListScreen() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadContracts();
  }, []);

  const loadContracts = async () => {
    try {
      const data = await api.getContracts();
      setContracts(data);
    } catch (error) {
      console.error("❌ Failed to load contracts:", error);
    } finally {
      setIsLoading(false);
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
      <TouchableOpacity style={styles.card}>
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

  return (
    <View style={styles.container}>
      {contracts.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>계약서가 없습니다</Text>
        </View>
      ) : (
        <FlatList
          data={contracts}
          renderItem={renderContract}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
        />
      )}
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
});
