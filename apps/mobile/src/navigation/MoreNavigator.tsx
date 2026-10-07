import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MoreMenuScreen from "../screens/MoreMenuScreen";
import ContractListScreen from "../screens/contracts/ContractListScreen";
import ContractDetailScreen from "../screens/contracts/ContractDetailScreen";
import ApprovalsScreen from "../screens/approvals/ApprovalsScreen";
import SettingsScreen from "../screens/SettingsScreen";
import SuggestionScreen from "../screens/SuggestionScreen";
import SubmissionsScreen from "../screens/SubmissionsScreen";
import MarketingScreen from "../screens/MarketingScreen";

const Stack = createNativeStackNavigator();

/**
 * 더보기 스택: 메뉴 → 결재(원장·본부·원장대행), 계약서(목록/상세), 설정 — 휴가는 하단 탭(2026-10-07 #17)
 */
export default function MoreNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ title: "더보기" }} />
      <Stack.Screen name="Contracts" component={ContractListScreen} options={{ title: "계약서" }} />
      <Stack.Screen name="ContractDetail" component={ContractDetailScreen} options={{ title: "계약서 상세" }} />
      <Stack.Screen name="Approvals" component={ApprovalsScreen} options={{ title: "결재" }} />
      <Stack.Screen name="Suggestions" component={SuggestionScreen} options={{ title: "개선 제안" }} />
      <Stack.Screen name="Submissions" component={SubmissionsScreen} options={{ title: "자료제출" }} />
      <Stack.Screen name="Marketing" component={MarketingScreen} options={{ title: "마케팅 자료" }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "설정" }} />
    </Stack.Navigator>
  );
}
