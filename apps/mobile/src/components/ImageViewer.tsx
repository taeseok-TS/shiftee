import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

// 사진 뷰어 한 페이지 — 원본 로딩 중 스피너, 실패 시 안내, 핀치 줌
// iOS: ScrollView 내장 줌(확대 유지 + 드래그 이동, 더블탭·페이지 이탈 시 리셋).
// Android: ScrollView 줌 속성이 iOS 전용이라 직접 구현한다.
//   핀치로 확대하면 손을 떼도 유지되고, 확대 상태에서 한 손가락으로 끌어 이동한다.
//   더블탭으로 확대↔원복. 확대 중에는 부모의 좌우 페이징을 잠근다(onZoomChange).
const VIEWER_MAX_SCALE = 4;
export function ViewerPage({ uri, width, height, active, onZoomChange }: { uri: string; width: number; height: number; active: boolean; onZoomChange?: (zoomed: boolean) => void }) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const scrollRef = useRef<ScrollView>(null);
  const lastTap = useRef(0);

  // Animated.Value 는 현재값을 동기적으로 읽을 수 없다. 손을 떼도 배율을 유지하려면
  // 확정값을 따로 들고 있어야 한다(cur). start 는 제스처 시작 시점의 스냅샷.
  const cur = useRef({ s: 1, x: 0, y: 0 });
  const start = useRef({ dist: 0, s: 1, x: 0, y: 0 });
  const zoomedRef = useRef(false);

  const notifyZoom = (s: number) => {
    const z = s > 1.01;
    if (z !== zoomedRef.current) { zoomedRef.current = z; onZoomChange?.(z); }
  };
  // 확대한 만큼만 움직이게 제한 — 안 하면 사진이 화면 밖으로 날아가 되돌아오지 못한다
  const clampXY = (s: number, x: number, y: number) => {
    const mx = (width * (s - 1)) / 2, my = (height * (s - 1)) / 2;
    return { x: Math.min(mx, Math.max(-mx, x)), y: Math.min(my, Math.max(-my, y)) };
  };
  const apply = (s: number, x: number, y: number) => {
    cur.current = { s, x, y };
    scale.setValue(s); tx.setValue(x); ty.setValue(y);
    notifyZoom(s);
  };
  const springTo = (s: number, x: number, y: number) => {
    cur.current = { s, x, y };
    notifyZoom(s);
    Animated.parallel([
      Animated.spring(scale, { toValue: s, useNativeDriver: true, bounciness: 0 }),
      Animated.spring(tx, { toValue: x, useNativeDriver: true, bounciness: 0 }),
      Animated.spring(ty, { toValue: y, useNativeDriver: true, bounciness: 0 }),
    ]).start();
  };

  const resetZoom = () => {
    if (Platform.OS === "ios") (scrollRef.current as any)?.scrollResponderZoomTo?.({ x: 0, y: 0, width, height, animated: true });
    else springTo(1, 0, 0);
  };
  // 다른 페이지로 넘어가면 확대 상태 초기화 — 돌아왔을 때 확대가 남아 페이징이 막히는 문제 방지
  useEffect(() => {
    if (!active) resetZoom();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const pinchPan = useRef(
    PanResponder.create({
      // 탭은 가로채지 않는다(더블탭은 Pressable 이 받는다). 1배일 때 한 손가락 스와이프도
      // 부모 페이징에 넘겨야 하므로 아래 조건에서만 responder 를 잡는다.
      onMoveShouldSetPanResponder: (e, g) =>
        Platform.OS === "android" &&
        (e.nativeEvent.touches.length === 2 || (cur.current.s > 1.01 && (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2))),
      // 부모(가로 페이징 FlatList)가 먼저 responder를 잡아도 가로챈다
      onMoveShouldSetPanResponderCapture: (e, g) =>
        Platform.OS === "android" &&
        (e.nativeEvent.touches.length === 2 || (cur.current.s > 1.01 && (Math.abs(g.dx) > 2 || Math.abs(g.dy) > 2))),
      onPanResponderTerminationRequest: () => false, // 제스처 도중 부모의 탈취 금지(확대가 튀는 현상 방지)
      onPanResponderGrant: (e) => {
        const t = e.nativeEvent.touches;
        start.current = {
          dist: t.length === 2 ? Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY) : 0,
          s: cur.current.s, x: cur.current.x, y: cur.current.y,
        };
      },
      onPanResponderMove: (e, g) => {
        const t = e.nativeEvent.touches;
        if (t.length === 2) {
          const d = Math.hypot(t[0].pageX - t[1].pageX, t[0].pageY - t[1].pageY);
          if (!start.current.dist) { start.current.dist = d; return; }
          const s = Math.min(VIEWER_MAX_SCALE, Math.max(1, start.current.s * (d / start.current.dist)));
          const p = clampXY(s, start.current.x, start.current.y);
          apply(s, p.x, p.y);
        } else if (cur.current.s > 1.01) {
          const p = clampXY(cur.current.s, start.current.x + g.dx, start.current.y + g.dy);
          apply(cur.current.s, p.x, p.y);
        }
      },
      onPanResponderRelease: () => {
        start.current.dist = 0;
        // 1배 이하로 오므리면 원위치. 확대 상태면 그대로 두되 경계 안으로만 정리한다.
        if (cur.current.s <= 1.01) springTo(1, 0, 0);
        else { const p = clampXY(cur.current.s, cur.current.x, cur.current.y); springTo(cur.current.s, p.x, p.y); }
      },
      onPanResponderTerminate: () => {
        start.current.dist = 0;
        if (cur.current.s <= 1.01) springTo(1, 0, 0);
      },
    })
  ).current;

  // 더블탭 — iOS 는 ScrollView 줌 리셋, Android 는 2.5배↔원복 토글
  const onDoubleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (Platform.OS === "ios") resetZoom();
      else springTo(cur.current.s > 1.01 ? 1 : 2.5, 0, 0);
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
  };

  const img = failed ? (
    <Text style={{ color: "#9ca3af", fontSize: 13 }}>사진을 불러오지 못했습니다</Text>
  ) : (
    <Animated.Image
      source={{ uri }}
      // transform 은 뒤쪽이 먼저 적용된다 — scale 이 먼저라 translate 는 화면 픽셀 그대로 움직인다
      style={{ width: "100%", height: "100%", transform: Platform.OS === "android" ? [{ translateX: tx }, { translateY: ty }, { scale }] : undefined }}
      resizeMode="contain"
      onLoadEnd={() => setLoading(false)}
      onError={() => { setLoading(false); setFailed(true); }}
    />
  );

  return (
    <View style={{ width, height: "100%", justifyContent: "center", alignItems: "center" }}>
      {Platform.OS === "ios" ? (
        <ScrollView
          ref={scrollRef}
          style={{ width, height: "100%" }}
          contentContainerStyle={{ width, height: "100%", justifyContent: "center", alignItems: "center" }}
          minimumZoomScale={1}
          maximumZoomScale={4}
          bouncesZoom
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
          centerContent
        >
          {/* 더블탭 = 확대 초기화 (확대 상태에서 페이징이 잠기는 것의 탈출구) */}
          <Pressable style={{ width: "100%", height: "100%" }} onPress={onDoubleTap}>
            {img}
          </Pressable>
        </ScrollView>
      ) : (
        <View style={{ width, height: "100%", justifyContent: "center", alignItems: "center" }} {...pinchPan.panHandlers}>
          {/* 더블탭 = 2.5배↔원복. 확대는 핀치로, 이동은 확대 상태에서 한 손가락 끌기 */}
          <Pressable style={{ width: "100%", height: "100%" }} onPress={onDoubleTap}>
            {img}
          </Pressable>
        </View>
      )}
      {loading && !failed && (
        <ActivityIndicator size="large" color="#fff" style={{ position: "absolute" }} />
      )}
    </View>
  );
}

// 공지 첨부 사진 등에서 쓰는 단순 뷰어 — 좌우로 넘기고, 핀치·더블탭으로 확대한다.
// 채팅 뷰어(WorkChatScreen)는 다운로드·묶음 저장이 붙어 있어 따로 두고, 여기서는 보기만 한다.
export function ImageViewerModal({ urls, index, onClose }: { urls: string[]; index: number; onClose: () => void }) {
  const { width: winW, height: winH } = Dimensions.get("window");
  const [cur, setCur] = useState(index);
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => setCur(index), [index]);

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <FlatList
          data={urls}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEnabled={!zoomed}
          keyExtractor={(u, i) => `${i}-${u}`}
          initialScrollIndex={index}
          extraData={cur}
          getItemLayout={(_d, i) => ({ length: winW, offset: winW * i, index: i })}
          onScroll={(e) => setCur(Math.round(e.nativeEvent.contentOffset.x / winW))}
          scrollEventThrottle={16}
          renderItem={({ item: u, index: pi }) => (
            <ViewerPage uri={u} width={winW} height={winH} active={pi === cur} onZoomChange={setZoomed} />
          )}
        />
        <View style={{ position: "absolute", top: 44, left: 16, right: 16, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Text style={{ color: "#fff", fontSize: 14 }}>{urls.length > 1 ? `${cur + 1} / ${urls.length}` : ""}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
