import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";

// 채팅 버블 내 음성 메시지 재생 (expo-audio)
// 재생/일시정지 + 진행 바 + 시간 표시. expo-audio는 재생 완료 후 위치가 자동 리셋되지 않으므로
// 끝났으면 seekTo(0) 후 다시 재생한다.
const fmt = (sec: number) => {
  const s = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function VoiceBubble({ uri, mine }: { uri: string; mine?: boolean }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);

  const playing = status.playing;
  const duration = status.duration || 0;
  const position = status.currentTime || 0;
  const progress = duration > 0 ? Math.min(1, position / duration) : 0;

  const toggle = async () => {
    if (playing) {
      player.pause();
      return;
    }
    // 끝까지 재생된 상태면 처음으로 되감고 재생
    if (duration > 0 && position >= duration - 0.15) await player.seekTo(0);
    player.play();
  };

  const fg = mine ? "#fff" : "#4f46e5";
  const track = mine ? "rgba(255,255,255,0.35)" : "#e0e7ff";

  return (
    <View style={styles.row}>
      <TouchableOpacity onPress={toggle} style={[styles.playBtn, { borderColor: fg }]} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
        <Ionicons name={playing ? "pause" : "play"} size={15} color={fg} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <View style={[styles.track, { backgroundColor: track }]}>
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: fg }]} />
        </View>
        <Text style={[styles.time, { color: mine ? "rgba(255,255,255,0.85)" : "#6b7280" }]}>
          {fmt(playing || position > 0 ? position : duration)}
        </Text>
      </View>
      <Ionicons name="mic" size={13} color={mine ? "rgba(255,255,255,0.7)" : "#9ca3af"} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 8, width: 190, paddingVertical: 2 },
  playBtn: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
  },
  track: { height: 4, borderRadius: 2, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 2 },
  time: { fontSize: 11, marginTop: 3 },
});
