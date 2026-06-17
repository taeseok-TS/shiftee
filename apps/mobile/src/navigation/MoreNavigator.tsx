import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import MoreMenuScreen from "../screens/MoreMenuScreen";
import ContractListScreen from "../screens/contracts/ContractListScreen";
import ContractDetailScreen from "../screens/contracts/ContractDetailScreen";
import LeaveRequestScreen from "../screens/leave/LeaveRequestScreen";
import SettingsScreen from "../screens/SettingsScreen";

const Stack = createNativeStackNavigator();

/**
 * 더보기 스택: 메뉴 → 계약서(목록/상세), 휴가, 설정
 */
export default function MoreNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="MoreMenu" component={MoreMenuScreen} options={{ title: "더보기" }} />
      <Stack.Screen name="Contracts" component={ContractListScreen} options={{ title: "계약서" }} />
      <Stack.Screen name="ContractDetail" component={ContractDetailScreen} options={{ title: "계약서 상세" }} />
      <Stack.Screen name="Leave" component={LeaveRequestScreen} options={{ title: "휴가" }} />
      <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: "설정" }} />
    </Stack.Navigator>
  );
}
