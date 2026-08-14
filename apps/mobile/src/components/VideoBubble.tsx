import React, { useRef } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";

// 채팅 버블 내 동영상 인라인 재생 (expo-video)
// 우상단 확대 버튼 → 전체화면(네이티브 플레이어), 닫으면 원래 버블로 복귀
export default function VideoBubble({ uri }: { uri: string }) {
  const viewRef = useRef<VideoView>(null);
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  return (
    <View>
      <VideoView
        ref={viewRef}
        player={player}
        style={styles.video}
        nativeControls
        allowsFullscreen
        contentFit="contain"
      />
      <TouchableOpacity
        style={styles.expandBtn}
        onPress={() => viewRef.current?.enterFullscreen()}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Ionicons name="expand" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  video: { width: 230, height: 150, borderRadius: 10, backgroundColor: "#111827" },
  expandBtn: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
});
