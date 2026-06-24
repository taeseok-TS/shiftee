import React, { useEffect, useState } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import HomeScreen from "../screens/HomeScreen";
import WorkNavigator from "./WorkNavigator";
import ScheduleScreen from "../screens/schedule/ScheduleScreen";
import AttendanceScreen from "../screens/attendance/AttendanceScreen";
import MoreNavigator from "./MoreNavigator";
import ApprovalsScreen from "../screens/approvals/ApprovalsScreen";
import * as storage from "../services/storage";

const Tab = createBottomTabNavigator();

/**
 * 인증 후 메인 앱 네비게이터 (탭 네비게이션)
 * 홈 · 메신저 · 일정 · 출퇴근 · 더보기(계약서/휴가/설정)
 */
export default function AppNavigator() {
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    storage.getUser().then((u) => setRole(u?.role ?? null)).catch(() => {});
  }, []);

  const canApprove = role === "ADMIN" || role === "MANAGER";

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "home";

          if (route.name === "Home") {
            iconName = focused ? "home" : "home-outline";
          } else if (route.name === "Approvals") {
            iconName = focused ? "checkmark-done-circle" : "checkmark-done-circle-outline";
          } else if (route.name === "Work") {
            iconName = focused ? "chatbubbles" : "chatbubbles-outline";
          } else if (route.name === "Schedule") {
            iconName = focused ? "calendar" : "calendar-outline";
          } else if (route.name === "Attendance") {
            iconName = focused ? "time" : "time-outline";
          } else if (route.name === "More") {
            iconName = focused ? "ellipsis-horizontal-circle" : "ellipsis-horizontal-circle-outline";
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: "#4f46e5",
        tabBarInactiveTintColor: "#9ca3af",
        headerShown: true,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: "홈" }} />
      {canApprove && (
        <Tab.Screen name="Approvals" component={ApprovalsScreen} options={{ title: "결재" }} />
      )}
      <Tab.Screen name="Work" component={WorkNavigator} options={{ title: "메신저", headerShown: false }} />
      <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ title: "일정" }} />
      <Tab.Screen name="Attendance" component={AttendanceScreen} options={{ title: "출퇴근" }} />
      <Tab.Screen name="More" component={MoreNavigator} options={{ title: "더보기", headerShown: false }} />
    </Tab.Navigator>
  );
}
