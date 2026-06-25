import React from "react";
import { View, TouchableOpacity } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import WorkChannelListScreen from "../screens/work/WorkChannelListScreen";
import WorkChatScreen from "../screens/work/WorkChatScreen";
import WorkAnnouncementsScreen from "../screens/work/WorkAnnouncementsScreen";
import WorkNewChannelScreen from "../screens/work/WorkNewChannelScreen";

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
            <View style={{ flexDirection: "row", gap: 18 }}>
              <TouchableOpacity onPress={() => navigation.navigate("WorkNewChannel")}>
                <Ionicons name="create-outline" size={22} color="#4f46e5" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => navigation.navigate("WorkAnnouncements")}>
                <Ionicons name="megaphone-outline" size={22} color="#4f46e5" />
              </TouchableOpacity>
            </View>
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
      <Stack.Screen
        name="WorkNewChannel"
        component={WorkNewChannelScreen}
        options={{ title: "새 채널 / 대화" }}
      />
    </Stack.Navigator>
  );
}
