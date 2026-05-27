import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

// 임시 스크린 (나중에 실제 컴포넌트로 대체)
import ContractListScreen from "../screens/contracts/ContractListScreen";
import AttendanceScreen from "../screens/attendance/AttendanceScreen";
import LeaveRequestScreen from "../screens/leave/LeaveRequestScreen";
import SettingsScreen from "../screens/SettingsScreen";

const Tab = createBottomTabNavigator();

/**
 * 인증 후 메인 앱 네비게이터 (탭 네비게이션)
 */
export default function AppNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "home";

          if (route.name === "Contracts") {
            iconName = focused ? "document-text" : "document-text-outline";
          } else if (route.name === "Attendance") {
            iconName = focused ? "time" : "time-outline";
          } else if (route.name === "Leave") {
            iconName = focused ? "calendar" : "calendar-outline";
          } else if (route.name === "Settings") {
            iconName = focused ? "settings" : "settings-outline";
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: "#2563eb",
        tabBarInactiveTintColor: "#9ca3af",
        headerShown: true,
      })}
    >
      <Tab.Screen
        name="Contracts"
        component={ContractListScreen}
        options={{ title: "계약서" }}
      />
      <Tab.Screen
        name="Attendance"
        component={AttendanceScreen}
        options={{ title: "출퇴근" }}
      />
      <Tab.Screen
        name="Leave"
        component={LeaveRequestScreen}
        options={{ title: "휴가" }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: "설정" }}
      />
    </Tab.Navigator>
  );
}
