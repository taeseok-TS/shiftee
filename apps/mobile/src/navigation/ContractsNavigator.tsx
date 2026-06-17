import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ContractListScreen from "../screens/contracts/ContractListScreen";
import ContractDetailScreen from "../screens/contracts/ContractDetailScreen";

const Stack = createNativeStackNavigator();

/**
 * 계약서 스택 (목록 → 상세)
 */
export default function ContractsNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="ContractList"
        component={ContractListScreen}
        options={{ title: "계약서" }}
      />
      <Stack.Screen
        name="ContractDetail"
        component={ContractDetailScreen}
        options={{ title: "계약서 상세" }}
      />
    </Stack.Navigator>
  );
}
