import React from "react";
import { TouchableOpacity } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import WorkChannelListScreen from "../screens/work/WorkChannelListScreen";
import WorkChatScreen from "../screens/work/WorkChatScreen";
import WorkAnnouncementsScreen from "../screens/work/WorkAnnouncementsScreen";

const Stack = createNativeStackNavigator();

/**
 * 큐브티워크 스택: 채널 목록 → 채팅, 공지
 */
export default function WorkNavigator() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="WorkChannels"
        component={WorkChannelListScreen}
        options={({ navigation }) => ({
          title: "큐브티워크",
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate("WorkAnnouncements")}>
              <Ionicons name="megaphone-outline" size={22} color="#4f46e5" />
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen
        name="WorkChat"
        component={WorkChatScreen}
        options={({ route }: any) => ({ title: route.params?.name || "채팅" })}
      />
      <Stack.Screen
        name="WorkAnnouncements"
        component={WorkAnnouncementsScreen}
        options={{ title: "공지" }}
      />
    </Stack.Navigator>
  );
}
