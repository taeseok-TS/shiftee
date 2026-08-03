import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Animated,
  PanResponder,
  Alert,
  Modal,
  Switch,
  TextInput,
  DeviceEventEmitter,
  BackHandler,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation, useFocusEffect, useRoute, useIsFocused } from "@react-navigation/native";
import { WorkChannel } from "@shiftee/api";
import * as api from "../../services/api";
import * as storage from "../../services/storage";
import { deleteChannel, hideChannel, leaveChannel, setChannelPin, getWorkMuteAll, setWorkMuteAll } from "../../services/channels";
import Avatar from "../../components/Avatar";

const ACTION_W = 84;

// 스와이프 가능한 채널 행 (왼쪽으로 밀면 삭제/나가기 버튼)
function SwipeableChannelRow({
  item,
  onOpen,
  onAction,
}: {
  item: WorkChannel;
  onOpen: () => void;
  onAction: () => void;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const isDefault = item.isDefault;
  const amCreator = (item as any).amCreator === true;
  const actionLabel = item.type === "DM" ? "숨기기" : amCreator ? "삭제" : "나가기";

  const animate = (to: number) => {
    openRef.current = to !== 0;
    Animated.timing(translateX, { toValue: to, duration: 150, useNativeDriver: true }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        !isDefault && Math.abs(g.dx) > Math.abs(g.dy) * 1.5 && Math.abs(g.dx) > 8,
      onPanResponderMove: (_e, g) => {
        let x = (openRef.current ? -ACTION_W : 0) + g.dx;
        if (x > 0) x = 0;
        if (x < -ACTION_W) x = -ACTION_W;
        translateX.setValue(x);
      },
      onPanResponderRelease: (_e, g) => {
        animate(g.dx < -ACTION_W / 2 ? -ACTION_W : 0);
      },
    })
  ).current;

  return (
    <View style={styles.swipeWrap}>
      {!isDefault && (
        <TouchableOpacity
          style={[styles.actionBtn, actionLabel === "삭제" ? styles.actionDelete : styles.actionLeave]}
          onPress={() => {
            animate(0);
            onAction();
          }}
        >
          <Ionicons name={actionLabel === "삭제" ? "trash" : actionLabel === "숨기기" ? "eye-off-outline" : "exit-outline"} size={20} color="#fff" />
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
      <Animated.View style={[styles.rowAnimated, { transform: [{ translateX }] }]} {...pan.panHandlers}>
        <TouchableOpacity
          activeOpacity={0.8}
          style={styles.item}
          onPress={() => {
            if (openRef.current) animate(0);
            else onOpen();
          }}
        >
          {item.type === "DM" ? (
            <Avatar name={item.name} size={44} uri={item.avatarUrl} />
          ) : item.labelText ? (
            // 웹 채널 관리에서 설정한 라벨 — 색상 배경 + 라벨 글자로 채널을 한눈에 구분
            <View style={[styles.avatar, { backgroundColor: item.labelColor || "#6b7280" }]}>
              <Text style={styles.avatarLabelText} numberOfLines={1}>{item.labelText.slice(0, 2)}</Text>
            </View>
          ) : (
            <View style={styles.avatar}>
              <Ionicons name="people" size={20} color="#fff" />
            </View>
          )}
          <View style={styles.itemBody}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {item.pinned && <Ionicons name="pin" size={13} color="#4f46e5" />}
              <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
            </View>
            <Text style={styles.itemLast} numberOfLines={1}>
              {item.lastMessage?.content || "메시지가 없습니다"}
            </Text>
          </View>
          {item.unread > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadText}>{item.unread > 99 ? "99+" : item.unread}</Text>
            </View>
          )}
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

export default function WorkChannelListScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const listRef = useRef<FlatList<WorkChannel>>(null);
  const [channels, setChannels] = useState<WorkChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [myId, setMyId] = useState("");
  // 더보기(⋮) 메뉴 — 채팅방 검색·상단 고정·전체 알림 (헤더가 늘어지지 않게 추가 기능은 이 안에)
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pinManageOpen, setPinManageOpen] = useState(false);
  const [muteAll, setMuteAll] = useState(false);
  const isFocused = useIsFocused();
  const focusedRef = useRef(isFocused);
  focusedRef.current = isFocused;
  const loadingRef = useRef(true);

  useEffect(() => {
    storage.getUser().then((u) => setMyId(u?.id || "")).catch(() => {});
  }, []);

  // 헤더 ⋮ 버튼 → menuTick 파라미터 갱신 → 메뉴 열기.
  // 소비 후 params를 비워 상태 지속·딥링크가 추가돼도 유령 오픈이 없게 한다.
  // 초기 로딩 중에는 무시(로드 완료 순간 메뉴가 튀어나오는 지연 오픈 방지).
  useEffect(() => {
    if (!route.params?.menuTick) return;
    navigation.setParams({ menuTick: undefined });
    if (!loadingRef.current) setMenuOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params?.menuTick]);

  // 메신저 탭 두 번 탭 → 목록 최상단으로 스크롤 (AppNavigator tabPress에서 emit).
  // 이 화면이 보일 때만 — 채팅방(WorkChat)에서 탭으로 복귀(popToTop)하는 경우엔 스크롤 위치 유지.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener("workTabPressAgain", () => {
      if (focusedRef.current) listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
    return () => sub.remove();
  }, []);

  // 검색바가 열려 있으면 안드로이드 백 키로 검색만 닫는다(화면 이탈 방지)
  useEffect(() => {
    if (!searchOpen) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setSearchOpen(false);
      setSearchQuery("");
      return true;
    });
    return () => sub.remove();
  }, [searchOpen]);

  const load = useCallback(async () => {
    try {
      const c = await api.getChannels();
      setChannels(c);
    } catch (error) {
      console.error("❌ Failed to load channels:", error);
    } finally {
      setLoading(false);
      loadingRef.current = false;
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
      // 전체 알림 설정은 다른 기기·웹에서 바뀔 수 있어 포커스마다 재조회
      getWorkMuteAll().then(setMuteAll).catch(() => {});
      return () => {
        // 채팅방 갔다 돌아왔을 때 필터된 빈 목록으로 보이지 않게 검색 초기화
        setSearchOpen(false);
        setSearchQuery("");
      };
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  // DM → 나만 숨기기 / 그룹 방장 → 채널 삭제 / 그룹 멤버 → 나가기
  const handleAction = (item: WorkChannel) => {
    const amCreator = (item as any).amCreator === true;
    const isDM = item.type === "DM";
    const isDelete = !isDM && amCreator;
    const verb = isDM ? "숨기기" : amCreator ? "삭제" : "나가기";
    const msg = isDM
      ? `"${item.name}"님과의 대화를 목록에서 숨길까요?\n새 메시지가 오면 다시 표시됩니다.`
      : isDelete
      ? `"${item.name}" 채널을 삭제할까요?\n모든 멤버에게서 사라집니다.`
      : `"${item.name}"에서 나갈까요?`;
    Alert.alert(verb, msg, [
      { text: "취소", style: "cancel" },
      {
        text: verb,
        style: "destructive",
        onPress: async () => {
          try {
            if (isDM) await hideChannel(item.id);
            else if (isDelete) await deleteChannel(item.id);
            else await leaveChannel(item.id, myId);
            load();
          } catch (e: any) {
            Alert.alert("오류", e?.response?.data?.error || "처리 중 오류가 발생했습니다.");
          }
        },
      },
    ]);
  };

  // 전체 알림 끄기 토글 — 메시지는 수신하되 푸시만 차단 (방별 알림 끄기와 별개)
  const toggleMuteAll = async (on: boolean) => {
    setMuteAll(on);
    try { await setWorkMuteAll(on); }
    catch { setMuteAll(!on); Alert.alert("오류", "알림 설정 변경에 실패했습니다."); }
  };

  // 상단 고정 토글 — 시트가 열린 동안에는 낙관적으로 pinned만 바꿔 순서를 고정(재정렬로 인한 오탭 방지),
  // 목록 재정렬(서버 핀 우선 정렬)은 시트를 닫을 때 재조회로 반영
  const pinBusy = useRef(new Set<string>());
  const togglePin = async (item: WorkChannel) => {
    if (pinBusy.current.has(item.id)) return; // 응답 전 재탭으로 같은 값 재전송 방지
    pinBusy.current.add(item.id);
    const next = !item.pinned;
    setChannels((prev) => prev.map((c) => (c.id === item.id ? { ...c, pinned: next } : c)));
    try { await setChannelPin(item.id, next); }
    catch {
      setChannels((prev) => prev.map((c) => (c.id === item.id ? { ...c, pinned: !next } : c)));
      Alert.alert("오류", "상단 고정 변경에 실패했습니다.");
    } finally { pinBusy.current.delete(item.id); }
  };
  const closePinManage = () => { setPinManageOpen(false); load(); };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  const q = searchQuery.trim().toLowerCase();
  const displayed = searchOpen && q ? channels.filter((c) => c.name.toLowerCase().includes(q)) : channels;

  return (
    <View style={styles.container}>
      {/* 채팅방 검색바 (⋮ 메뉴 → 채팅방 검색) */}
      {searchOpen && (
        <View style={styles.searchBar}>
          <Ionicons name="search" size={16} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="채팅방 이름 검색"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          <TouchableOpacity onPress={() => { setSearchOpen(false); setSearchQuery(""); }}>
            <Ionicons name="close-circle" size={18} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      )}
      <FlatList
        ref={listRef}
        style={styles.container}
        data={displayed}
        keyExtractor={(c) => c.id}
        renderItem={({ item }) => (
          <SwipeableChannelRow
            item={item}
            onOpen={() => navigation.navigate("WorkChat", { channelId: item.id, name: item.name, notify: item.notify, type: item.type, isDefault: item.isDefault })}
            onAction={() => handleAction(item)}
          />
        )}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={<Text style={styles.empty}>{searchOpen && q ? "검색 결과가 없습니다." : "채널이 없습니다."}</Text>}
      />

      {/* 더보기(⋮) 메뉴 */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.menuBg} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          {/* 카드 내부 빈 영역(라벨·힌트) 터치가 배경으로 전파돼 메뉴가 닫히지 않게 차단 */}
          <View style={styles.menuCard} onStartShouldSetResponder={() => true}>
            <TouchableOpacity style={styles.menuRow} onPress={() => { setMenuOpen(false); setSearchOpen(true); }}>
              <Ionicons name="search-outline" size={20} color="#374151" />
              <Text style={styles.menuText}>채팅방 검색</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.menuRow} onPress={() => {
              setMenuOpen(false);
              // iOS는 모달 dismiss와 present가 겹치면 시트가 안 뜰 수 있어 닫힘 후에 연다
              setTimeout(() => setPinManageOpen(true), 350);
            }}>
              <Ionicons name="pin-outline" size={20} color="#374151" />
              <Text style={styles.menuText}>상단 고정 관리</Text>
            </TouchableOpacity>
            <View style={styles.menuRow}>
              <Ionicons name={muteAll ? "notifications-off-outline" : "notifications-outline"} size={20} color="#374151" />
              <Text style={[styles.menuText, { flex: 1 }]}>전체 알림 끄기</Text>
              <Switch value={muteAll} onValueChange={toggleMuteAll} />
            </View>
            {muteAll && (
              <Text style={styles.menuHint}>채팅 메시지·공지·리마인더 푸시가 꺼집니다. 메시지는 정상 수신되며, 결재 알림은 계속 옵니다.</Text>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 상단 고정 관리 — 채팅방을 탭해 고정/해제 (닫을 때 재조회로 목록 재정렬 반영) */}
      <Modal visible={pinManageOpen} transparent animationType="slide" onRequestClose={closePinManage}>
        <View style={styles.sheetBg}>
          <View style={styles.sheetCard}>
            <View style={styles.sheetHead}>
              <Text style={styles.sheetTitle}>상단 고정 관리</Text>
              <TouchableOpacity onPress={closePinManage}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>
            <Text style={styles.sheetHint}>채팅방을 누르면 목록 맨 위에 고정됩니다.</Text>
            {/* RN은 flexShrink 기본 0 — 스크롤 뷰 자신에게 maxHeight를 줘야 시트 안에서 스크롤된다 */}
            <FlatList
              style={{ maxHeight: 420 }}
              data={channels}
              keyExtractor={(c) => c.id}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.pinRow} onPress={() => togglePin(item)}>
                  <Ionicons name={item.pinned ? "pin" : "pin-outline"} size={18} color={item.pinned ? "#4f46e5" : "#9ca3af"} />
                  <Text style={[styles.pinName, item.pinned && { color: "#4f46e5", fontWeight: "700" }]} numberOfLines={1}>{item.name}</Text>
                  {item.pinned && <Text style={styles.pinBadge}>고정됨</Text>}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 40 },
  swipeWrap: { backgroundColor: "#ef4444" },
  actionBtn: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_W,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  actionDelete: { backgroundColor: "#ef4444" },
  actionLeave: { backgroundColor: "#6b7280" },
  actionText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  rowAnimated: { backgroundColor: "#fff" },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
    backgroundColor: "#fff",
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#4f46e5",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarDm: { backgroundColor: "#0ea5e9" },
  avatarLabelText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  itemBody: { flex: 1, marginLeft: 12 },
  itemName: { fontSize: 16, fontWeight: "600", color: "#111827" },
  itemLast: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#ef4444",
    paddingHorizontal: 6,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  unreadText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginHorizontal: 12, marginTop: 8, marginBottom: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: "#f3f4f6", borderRadius: 10,
  },
  searchInput: { flex: 1, fontSize: 15, color: "#111827", padding: 0 },
  menuBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-start", alignItems: "flex-end", paddingTop: 52, paddingRight: 12 },
  menuCard: { backgroundColor: "#fff", borderRadius: 12, paddingVertical: 6, minWidth: 220, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  menuText: { fontSize: 15, color: "#374151" },
  menuHint: { fontSize: 11, color: "#9ca3af", paddingHorizontal: 16, paddingBottom: 10, marginTop: -4 },
  sheetBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "flex-end" },
  sheetCard: { backgroundColor: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: "70%", paddingBottom: 24 },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  sheetTitle: { fontSize: 16, fontWeight: "700", color: "#111827" },
  sheetHint: { fontSize: 12, color: "#9ca3af", paddingHorizontal: 16, paddingBottom: 8 },
  pinRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  pinName: { flex: 1, fontSize: 15, color: "#374151" },
  pinBadge: { fontSize: 11, color: "#4f46e5", fontWeight: "600" },
});
