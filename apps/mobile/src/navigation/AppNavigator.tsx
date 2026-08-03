import React, { useEffect, useState } from "react";
import { DeviceEventEmitter } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";

import HomeScreen from "../screens/HomeScreen";
import WorkNavigator from "./WorkNavigator";
import ScheduleScreen from "../screens/schedule/ScheduleScreen";
import AttendanceScreen from "../screens/attendance/AttendanceScreen";
import MoreNavigator from "./MoreNavigator";
import ApprovalsScreen from "../screens/approvals/ApprovalsScreen";
import * as storage from "../services/storage";
import { getUnreadCount } from "../services/channels";

const Tab = createBottomTabNavigator();

/**
 * 인증 후 메인 앱 네비게이터 (탭 네비게이션)
 * 홈 · 메신저 · 일정 · 출퇴근 · 더보기(계약서/휴가/설정)
 */
export default function AppNavigator() {
  const [role, setRole] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    storage.getUser().then((u) => setRole(u?.role ?? null)).catch(() => {});
  }, []);

  // 메신저 탭 배지: 미확인 메시지 수를 주기적으로 조회.
  // 앱 아이콘 뱃지(카톡식)도 같은 값으로 동기화 — 메시지를 읽으면 아이콘 숫자도 내려간다.
  // (백그라운드 수신 시에는 서버 푸시의 badge 필드가 OS 레벨에서 아이콘 뱃지를 설정)
  useEffect(() => {
    let alive = true;
    const tick = () => getUnreadCount().then((n) => {
      if (!alive) return;
      setUnread(n);
      Notifications.setBadgeCountAsync(n).catch(() => {});
    }).catch(() => {});
    tick();
    const t = setInterval(tick, 15000);
    return () => { alive = false; clearInterval(t); };
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
      <Tab.Screen
        name="Work"
        component={WorkNavigator}
        options={{
          title: "메신저",
          headerShown: false,
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
        }}
        listeners={({ navigation }) => ({
          // 이미 메신저 탭인 상태에서 다시 탭하면 채널 목록을 최상단으로 스크롤
          tabPress: () => {
            if (navigation.isFocused()) DeviceEventEmitter.emit("workTabPressAgain");
          },
        })}
      />
      <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ title: "일정" }} />
      <Tab.Screen name="Attendance" component={AttendanceScreen} options={{ title: "출퇴근" }} />
      <Tab.Screen name="More" component={MoreNavigator} options={{ title: "더보기", headerShown: false }} />
    </Tab.Navigator>
  );
}
