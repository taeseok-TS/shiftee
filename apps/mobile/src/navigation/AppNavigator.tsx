import React, { useEffect, useRef, useState } from "react";
import { AppState, DeviceEventEmitter, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import * as Notifications from "expo-notifications";

import HomeScreen from "../screens/HomeScreen";
import WorkNavigator from "./WorkNavigator";
import ScheduleScreen from "../screens/schedule/ScheduleScreen";
import AttendanceScreen from "../screens/attendance/AttendanceScreen";
import MoreNavigator from "./MoreNavigator";
import LeaveRequestScreen from "../screens/leave/LeaveRequestScreen";
import ApprovalsScreen from "../screens/approvals/ApprovalsScreen";
import { getUnreadCount } from "../services/channels";
import * as storage from "../services/storage";
import { refreshBadges, useBadgeCounts, badgeStyle, badgeText } from "../services/badges";

const Tab = createBottomTabNavigator();

/**
 * 인증 후 메인 앱 네비게이터 (탭 네비게이션)
 * 홈 · 휴가 · 메신저 · 출퇴근 · 일정 · 더보기(결재/계약서/설정) — 2026-10-07 본부 확정(#17)
 * 결재는 폰에서 쓸 일이 적어 더보기로 옮기고, 홈 「대기 결재」 칸에서 바로 들어간다.
 * 2026-10-23 본부 요청(앱 1): 원장 · 본부 계정은 「휴가」 자리에 「승인」(대기 수 주황 숫자) — 본인 휴가는 더보기 「내 휴가」.
 *   직원 계정은 그대로(원장대행 직원은 더보기 「승인」 줄). 서명할 계약서가 있으면 「더보기」에 주황 숫자(앱 8).
 */
export default function AppNavigator() {
  const [unread, setUnread] = useState(0);
  // 역할 — 원장 · 본부면 아래 탭 「승인」. 저장된 정보라 바로 온다(읽기 전엔 탭을 그리지 않는다 — 「휴가」가 잠깐 보였다 바뀌지 않게)
  const [role, setRole] = useState<string | null>(null);
  useEffect(() => { storage.getUser().then((u) => setRole(u?.role || "")).catch(() => setRole("")); }, []);
  const staff = role === "ADMIN" || role === "MANAGER";
  const badges = useBadgeCounts();
  // 승인 대기 · 서명할 계약서 수 — 30초마다, 앱으로 돌아올 때마다
  useEffect(() => {
    refreshBadges().catch(() => {});
    const t = setInterval(() => { refreshBadges().catch(() => {}); }, 30000);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refreshBadges().catch(() => {}); });
    return () => { clearInterval(t); sub.remove(); };
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

  // 알림을 누르면 그 메시지가 있는 채팅방으로 바로 들어간다.
  // 앱이 꺼져 있다가 알림으로 실행된 경우(cold start)까지 처리해야 해서 두 경로를 모두 본다.
  const navigation = useNavigation<any>();
  const handledRef = useRef<string | null>(null); // 같은 알림을 두 번 처리하지 않게
  const tabsReady = role !== null;   // 탭을 그린 뒤에 알림 이동을 건다(역할을 읽기 전엔 「메신저」 탭이 없어 이동이 사라진다)
  useEffect(() => {
    if (!tabsReady) return;
    const open = (res: Notifications.NotificationResponse | null) => {
      if (!res) return;
      const id = res.notification.request.identifier;
      if (handledRef.current === id) return;
      handledRef.current = id;
      const d: any = res.notification.request.content.data || {};
      if (d.type !== "work-message" || !d.channelId) return;
      // 탭(메신저) → 스택(채팅방) 순으로 이동. 파라미터는 채팅 화면이 쓰는 것과 같은 형태.
      // initial: false 가 핵심 — 없으면 채팅방이 스택의 첫 화면이 되어 채널 목록으로
      // 돌아갈 수 없다(뒤로 갈 곳이 없어 그 방에 갇힌다).
      navigation.navigate("Work", {
        screen: "WorkChat",
        initial: false,
        params: {
          channelId: String(d.channelId),
          name: d.channelName ? String(d.channelName) : undefined,
          type: d.channelType ? String(d.channelType) : undefined,
          focusMessageId: d.messageId ? String(d.messageId) : undefined,
        },
      });
    };
    // 앱이 꺼져 있다가 알림으로 실행된 경우
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    // 앱이 살아 있는 동안 알림을 누른 경우
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [navigation, tabsReady]);

  return (
    role === null ? <View style={{ flex: 1, backgroundColor: "#f3f4f6" }} /> :
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "home";

          if (route.name === "Home") {
            iconName = focused ? "home" : "home-outline";
          } else if (route.name === "Leave") {
            iconName = focused ? "umbrella" : "umbrella-outline";
          } else if (route.name === "Approve") {
            iconName = focused ? "checkmark-circle" : "checkmark-circle-outline";
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
      {staff ? (
        <Tab.Screen
          name="Approve"
          component={ApprovalsScreen}
          options={{ title: "승인", tabBarBadge: badgeText(badges.approvals), tabBarBadgeStyle: badgeStyle }}
          listeners={{ tabPress: () => { refreshBadges().catch(() => {}); } }}
        />
      ) : (
        <Tab.Screen name="Leave" component={LeaveRequestScreen} options={{ title: "휴가" }} />
      )}
      <Tab.Screen
        name="Work"
        component={WorkNavigator}
        options={{
          title: "메신저",
          headerShown: false,
          tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined,
          tabBarBadgeStyle: badgeStyle,   // 아래 탭 배지는 모두 같은 색(빨강, 2026-10-29 이예지)
        }}
        listeners={({ navigation }) => ({
          // 이미 메신저 탭인 상태에서 다시 탭하면 채널 목록을 최상단으로 스크롤
          tabPress: () => {
            if (navigation.isFocused()) DeviceEventEmitter.emit("workTabPressAgain");
          },
        })}
      />
      <Tab.Screen name="Attendance" component={AttendanceScreen} options={{ title: "출퇴근" }} />
      <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ title: "일정" }} />
      <Tab.Screen name="More" component={MoreNavigator} options={{ title: "더보기", headerShown: false, tabBarBadge: badgeText(badges.sign), tabBarBadgeStyle: badgeStyle }} />
    </Tab.Navigator>
  );
}
