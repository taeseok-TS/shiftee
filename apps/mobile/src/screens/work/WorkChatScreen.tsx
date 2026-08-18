import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  Alert,
  Platform,
  ToastAndroid,
  ScrollView,
  useWindowDimensions,
  PanResponder,
  Animated,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRoute, RouteProp, useNavigation } from "@react-navigation/native";
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { useHeaderHeight } from "@react-navigation/elements";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { WorkMessage, WorkChannel } from "@shiftee/api";
import * as Clipboard from "expo-clipboard";
import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library";
import Avatar from "../../components/Avatar";
import { ViewerPage } from "../../components/ImageViewer";
import VideoBubble from "../../components/VideoBubble";
import VoiceBubble from "../../components/VoiceBubble";
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from "expo-audio";
import * as api from "../../services/api";
import * as storage from "../../services/storage";
import { uploadFile, sendFileMessage, sendAlbumMessage, toggleReaction, sendTextMessage, deleteMessage, editMessage, getMessageReaders, ReaderEntry, toggleBookmark, forwardMessage, createScheduledMessage, getScheduledMessages, cancelScheduledMessage, ScheduledItem, createReminder, FILE_ORIGIN } from "../../services/work";
import DatePicker from "../../components/DatePicker";
import { getMembers, addChannelMembers, setChannelNotify, getChannelMemberIds, getChannelMembersList, ChannelMemberInfo, Member, postTyping, getTypingUsers, getLinkPreview, LinkPreviewData, renameChannel, leaveChannel, hideChannel, setChannelNotice, clearChannelNotice, getNoticeReaders, getChannelLinks, SharedLink, createPoll, votePoll, closePoll, createChannel } from "../../services/channels";

type ParamList = { WorkChat: { channelId: string; name: string; notify?: string; type?: string; isDefault?: boolean } };

// 자주쓰는 6개만 기본 노출, "더보기"로 전체 그리드
const EMOJIS = ["👍", "✅", "🙏", "😂", "❤️", "🫡"];
const EMOJIS_ALL = [
  "👍", "✅", "🙏", "😂", "❤️", "🫡",
  "😢", "😮", "👌", "🎉", "👏", "🔥",
  "💯", "😊", "😅", "🤣", "😭", "🥹",
  "🙇", "💪", "🤝", "🙌", "😍", "☕",
];

// 이모지만으로 된 짧은 메시지(3개 이하)는 크게 표시 (카톡식)
function isEmojiOnly(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  try {
    // 픽토그래프 + (변형선택자/스킨톤) + (ZWJ 결합) 을 이모지 1개로 계산
    const seq = "\\p{Extended_Pictographic}(?:\\uFE0F)?(?:[\\u{1F3FB}-\\u{1F3FF}])?";
    const re = new RegExp(`${seq}(?:\\u200D${seq})*`, "gu");
    const matches = t.match(re);
    if (!matches || matches.length === 0 || matches.length > 3) return false;
    return t.replace(re, "").replace(/\s/g, "") === "";
  } catch {
    return false;
  }
}

function firstUrl(text: string): string | null {
  const m = (text || "").match(/https?:\/\/[^\s]+/);
  return m ? m[0].replace(/[.,)\]]+$/, "") : null;
}

// 말풍선 단일 사진 — 원본 비율 유지 (고정 200×200 crop이라 세로/가로 사진이 잘려 보이던 문제 해결)
// 최대 230×320 박스에 비율대로 맞추고, 실제 크기는 한 번 재서 캐시(재렌더·스크롤 시 재측정 방지)
const bubbleImgSizeCache = new Map<string, { w: number; h: number }>();
function BubbleImage({ uri, onPress, onLongPress }: { uri: string; onPress: () => void; onLongPress: () => void }) {
  const [dim, setDim] = useState<{ w: number; h: number } | null>(bubbleImgSizeCache.get(uri) || null);
  useEffect(() => {
    if (bubbleImgSizeCache.has(uri)) { setDim(bubbleImgSizeCache.get(uri)!); return; }
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => { if (alive && w > 0 && h > 0) { bubbleImgSizeCache.set(uri, { w, h }); setDim({ w, h }); } },
      () => {}
    );
    return () => { alive = false; };
  }, [uri]);
  const MAX_W = 230, MAX_H = 320;
  let w = 200, h = 200; // 크기 파악 전 기본값 (기존과 동일)
  if (dim) {
    const r = Math.min(MAX_W / dim.w, MAX_H / dim.h, 1);
    w = Math.round(dim.w * r);
    h = Math.round(dim.h * r);
  }
  return (
    <TouchableOpacity onPress={onPress} onLongPress={onLongPress}>
      <Image source={{ uri }} style={{ width: w, height: h, borderRadius: 12, backgroundColor: "#f3f4f6" }} resizeMode="cover" />
    </TouchableOpacity>
  );
}

// 링크 미리보기 카드 (OG 메타)
function LinkPreview({ url, mine }: { url: string; mine: boolean }) {
  const [data, setData] = useState<LinkPreviewData>(null);
  useEffect(() => {
    let alive = true;
    getLinkPreview(url).then((p) => { if (alive) setData(p); });
    return () => { alive = false; };
  }, [url]);
  if (!data) return null;
  return (
    <TouchableOpacity onPress={() => Linking.openURL(data.url)} style={[styles.linkCard, mine ? styles.linkCardMine : styles.linkCardOther]}>
      {data.image ? <Image source={{ uri: data.image }} style={styles.linkImage} resizeMode="cover" /> : null}
      <View style={styles.linkBody}>
        {data.siteName ? <Text style={[styles.linkSite, mine && styles.linkSiteMine]} numberOfLines={1}>{data.siteName}</Text> : null}
        {data.title ? <Text style={[styles.linkTitle, mine && styles.linkTitleMine]} numberOfLines={2}>{data.title}</Text> : null}
        {data.description ? <Text style={[styles.linkDesc, mine && styles.linkDescMine]} numberOfLines={2}>{data.description}</Text> : null}
      </View>
    </TouchableOpacity>
  );
}


export default function WorkChatScreen() {
  const route = useRoute<RouteProp<ParamList, "WorkChat">>();
  const { channelId } = route.params;
  const [messages, setMessages] = useState<WorkMessage[]>([]);
  const [text, setText] = useState("");
  const [chanMembers, setChanMembers] = useState<ChannelMemberInfo[]>([]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const lastTypingPost = useRef(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false); // 상태 반영 지연을 뚫는 더블탭 가드
  const [uploading, setUploading] = useState(false);
  // 업로드 진행률 (%·남은 시간) — 대용량 영상 업로드 시 표시
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [uploadEtaSec, setUploadEtaSec] = useState<number | null>(null);
  const [reactionTarget, setReactionTarget] = useState<string | null>(null);
  const [emojiMore, setEmojiMore] = useState(false); // 리액션 이모지 전체 그리드 펼침
  useEffect(() => { if (!reactionTarget) setEmojiMore(false); }, [reactionTarget]);
  const [replyTarget, setReplyTarget] = useState<WorkMessage | null>(null);
  const [editTarget, setEditTarget] = useState<WorkMessage | null>(null);
  // 인앱 사진 뷰어 — 카톡처럼 채팅방 안에서 열고 좌우 스와이프로 채팅방의 모든 사진을 넘겨 본다.
  // 같은 사진을 전달하면 URL이 중복되므로 위치 식별은 (메시지id#순번) 키로 한다.
  // keys는 다운로드 시 현재 사진이 속한 메시지(앨범 여부)를 찾는 데도 쓴다
  const [imageViewer, setImageViewer] = useState<{ urls: string[]; keys: string[]; index: number } | null>(null);
  // 확대 중에는 좌우 페이징을 잠근다 — 안 그러면 확대한 사진을 끌 때 옆 사진으로 넘어간다
  const [viewerZoomed, setViewerZoomed] = useState(false);
  useEffect(() => { if (!imageViewer) setViewerZoomed(false); }, [imageViewer]);
  // 긴 메시지 접기: "전체 보기"를 누른 메시지 ID 집합
  const [expandedMsgs, setExpandedMsgs] = useState<Set<string>>(new Set());

  // 대기 첨부: 선택 즉시 보내지 않고 입력바 위에 대기 → 전송 버튼에서 글과 함께 한 메시지로 발송 (웹과 동일)
  type PendingAtt = { uri: string; name: string; mimeType: string | null; kind: "image" | "video" | "file" };
  const [pendingAtts, setPendingAtts] = useState<PendingAtt[]>([]);
  const attachFirstRef = useRef(false); // 첫 첨부 시점에 글이 비어 있었는지 (작성 순서 재현)
  const addPending = (items: PendingAtt[]) => {
    if (!items.length) return;
    if (pendingAtts.length === 0) attachFirstRef.current = !text.trim();
    let merged = [...pendingAtts, ...items];
    if (merged.filter((m) => m.kind === "image").length > 10) {
      Alert.alert("알림", "사진은 한 번에 최대 10장까지 첨부할 수 있습니다.");
      let n = 0;
      merged = merged.filter((m) => m.kind !== "image" || ++n <= 10);
    }
    setPendingAtts(merged);
  };
  // 채널이 바뀌면(재사용 내비게이션 대비) 대기 첨부 초기화
  useEffect(() => { setPendingAtts([]); attachFirstRef.current = false; }, [channelId]);
  // 방 전환 시 입력글이 따라가지 않게 — 채널별 임시저장(돌아오면 복원)
  const draftsRef = useRef<Record<string, string>>({});
  const prevChannelRef = useRef<string | null>(null);
  const textValRef = useRef("");
  textValRef.current = text;
  useEffect(() => {
    const prev = prevChannelRef.current;
    prevChannelRef.current = channelId;
    if (prev === channelId) return;
    if (prev) draftsRef.current[prev] = textValRef.current;
    setText(draftsRef.current[channelId] ?? "");
    setMentionQuery(null);
    setEditTarget(null);
    setReplyTarget(null);
  }, [channelId]);
  // 파일명/종류 판별 — 서버가 확장자로 fileType을 정하므로 mime과 확장자를 일치시킨다 (iOS HEIC → .jpg 변환본)
  const kindOf = (name: string, mime?: string | null): "image" | "video" | "file" =>
    mime?.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(name) ? "image"
    : mime?.startsWith("video/") || /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(name) ? "video" : "file";
  const normalizeImageName = (name: string, mime?: string | null) => {
    if (/\.(jpe?g|png|gif|webp)$/i.test(name)) return name;
    const ext = mime === "image/png" ? ".png" : mime === "image/gif" ? ".gif" : mime === "image/webp" ? ".webp" : ".jpg";
    return name.replace(/\.[^.]*$/, "") + ext;
  };
  const [viewerIndex, setViewerIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const listRef = useRef<FlatList<WorkMessage>>(null);
  // 알림을 눌러 들어온 경우 그 메시지로 스크롤하고 잠깐 강조한다
  const focusMessageId: string | undefined = (route.params as any)?.focusMessageId;
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const focusedRef = useRef<string | null>(null);
  const tabBarHeight = useBottomTabBarHeight();
  const headerHeight = useHeaderHeight();
  // iOS: 헤더 높이 + 하단 안전영역(홈 인디케이터)만큼 올려야 입력창이 키보드 위로 완전히 올라옴.
  // iOS: KAV 오프셋은 화면 상단~KAV 상단 거리 = 헤더 높이만. insets.bottom을 더하면
  // 키보드가 홈인디케이터 영역을 덮을 때 그만큼 입력창과 키보드 사이에 빈 틈이 생긴다.
  const kbOffset = Platform.OS === "ios" ? headerHeight : tabBarHeight;

  const navigation = useNavigation<any>();
  // 뷰어 페이지 폭 — 스타일·페이징 오프셋·카운터 계산이 반드시 같은 값을 써야 함(폴더블·분할화면 대응)
  const { width: winW, height: winH } = useWindowDimensions();
  const isGroup = route.params.type !== "DM";
  const [notify, setNotify] = useState(route.params.notify ?? "ALL");
  // 클립보드 이미지 붙여넣기 (캡처 후 복사한 이미지 감지 → 칩 표시)
  const [clipHasImage, setClipHasImage] = useState(false);
  const checkClipboard = async () => {
    try {
      setClipHasImage(await Clipboard.hasImageAsync());
    } catch {
      setClipHasImage(false);
    }
  };
  useEffect(() => {
    checkClipboard();
  }, []);

  const pasteClipboardImage = async () => {
    try {
      setUploading(true);
      const img = await Clipboard.getImageAsync({ format: "jpeg" });
      if (!img?.data) {
        setClipHasImage(false);
        return;
      }
      // data URI(base64) → 캐시 파일로 저장 후 기존 업로드 경로 재사용
      const base64 = img.data.includes(",") ? img.data.split(",")[1] : img.data;
      const path = `${FileSystem.cacheDirectory}clipboard_${Date.now()}.jpg`;
      await FileSystem.writeAsStringAsync(path, base64, { encoding: FileSystem.EncodingType.Base64 });
      await uploadAndSend({ uri: path, name: `clipboard_${Date.now()}.jpg`, mimeType: "image/jpeg" });
      setClipHasImage(false);
    } catch (e: any) {
      Alert.alert("실패", e?.message || "클립보드 이미지 전송 중 오류가 발생했습니다.");
    } finally {
      setUploading(false);
    }
  };

  // 채널 고정 공지
  const [notice, setNotice] = useState<{ content: string; imageUrl?: string | null; by: string | null; at: string | null; important?: boolean; unreadCount?: number } | null>(null);
  const [noticeCollapsed, setNoticeCollapsed] = useState(true); // 기본 접힘 — 긴 공지가 화면을 덮지 않게
  // X = 나에게만 숨김(카톡 방식). 등록 시각을 기억해 같은 공지만 숨기고, 새 공지가 오면 다시 보인다.
  const [noticeHidden, setNoticeHidden] = useState(false);
  const noticeStamp = notice ? (notice.at ?? notice.content) : null;
  useEffect(() => {
    if (!noticeStamp) { setNoticeHidden(false); return; }
    SecureStore.getItemAsync(`workNoticeHidden_${channelId}`)
      .then((v) => setNoticeHidden(v === noticeStamp))
      .catch(() => setNoticeHidden(false));
  }, [channelId, noticeStamp]);
  const hideNoticeForMe = () => {
    if (!noticeStamp) return;
    SecureStore.setItemAsync(`workNoticeHidden_${channelId}`, noticeStamp).catch(() => {});
    setNoticeHidden(true);
  };

  // 링크 모아보기
  const [linksOpen, setLinksOpen] = useState(false);
  const [linksData, setLinksData] = useState<SharedLink[] | null>(null);

  // 투표 만들기
  const [pollOpen, setPollOpen] = useState(false);
  const [pollQ, setPollQ] = useState("");
  const [pollOpts, setPollOpts] = useState<string[]>(["", ""]);
  const [pollMulti, setPollMulti] = useState(false);
  const [pollCloseHours, setPollCloseHours] = useState<number | null>(null); // 종료 시간 프리셋 (시간), null = 없음
  const [pollSubmitting, setPollSubmitting] = useState(false);

  const registerNotice = (m: WorkMessage) => {
    setReactionTarget(null);
    const doRegister = async (important: boolean) => {
      try {
        await setChannelNotice(channelId, m.content, m.fileType === "image" ? m.fileUrl : null, important);
        load();
      } catch (e: any) {
        Alert.alert("실패", e?.response?.data?.error || "공지 등록 중 오류가 발생했습니다.");
      }
    };
    Alert.alert("공지 등록", "이 메시지를 채팅방 공지로 등록할까요?\n\n중요 공지는 전 멤버에게 즉시 푸시되고, 확인 안 한 사람에게 매일 오전 9시 재알림됩니다.", [
      { text: "취소", style: "cancel" },
      { text: "일반 등록", onPress: () => doRegister(false) },
      { text: "🔴 중요 등록", onPress: () => doRegister(true) },
    ]);
  };

  // 공지 미확인자 명단 (읽음확인 모달 재사용)
  const openNoticeReaders = async () => {
    setReadersTab("unread");
    setReadersData(null);
    setReadersOpen(true);
    try {
      setReadersData(await getNoticeReaders(channelId));
    } catch {
      setReadersOpen(false);
      Alert.alert("오류", "공지 확인 정보를 불러오지 못했습니다.");
    }
  };

  // 방 전체에서 내리기 — 모두의 화면에서 사라진다(관리자·등록자용)
  const removeNotice = () => {
    Alert.alert("방 전체에서 내리기", "모든 구성원의 화면에서 공지가 사라집니다. 내릴까요?", [
      { text: "취소", style: "cancel" },
      { text: "내리기", style: "destructive", onPress: async () => { try { await clearChannelNotice(channelId); setNotice(null); } catch {} } },
    ]);
  };

  const openLinks = async () => {
    setMenuOpen(false);
    setLinksData(null);
    setLinksOpen(true);
    try {
      setLinksData(await getChannelLinks(channelId));
    } catch {
      setLinksData([]);
    }
  };

  const submitPoll = async () => {
    const opts = pollOpts.map((o) => o.trim()).filter(Boolean);
    if (!pollQ.trim() || opts.length < 2) {
      Alert.alert("알림", "질문과 선택지 2개 이상을 입력해주세요.");
      return;
    }
    setPollSubmitting(true);
    try {
      await createPoll(channelId, {
        question: pollQ.trim(), options: opts, multiple: pollMulti,
        closesAt: pollCloseHours ? new Date(Date.now() + pollCloseHours * 3600 * 1000).toISOString() : undefined,
      });
      setPollOpen(false);
      setPollQ("");
      setPollOpts(["", ""]);
      setPollMulti(false);
      setPollCloseHours(null);
      load();
    } catch (e: any) {
      Alert.alert("실패", e?.response?.data?.error || "투표 생성 중 오류가 발생했습니다.");
    } finally {
      setPollSubmitting(false);
    }
  };

  const onVote = async (pollId: string, idx: number) => {
    try {
      await votePoll(pollId, idx);
      load();
    } catch (e: any) {
      Alert.alert("실패", e?.response?.data?.error || "투표 중 오류가 발생했습니다.");
    }
  };

  const onClosePoll = (pollId: string) => {
    Alert.alert("투표 마감", "이 투표를 마감할까요?", [
      { text: "취소", style: "cancel" },
      { text: "마감", style: "destructive", onPress: async () => { try { await closePoll(pollId); load(); } catch (e: any) { Alert.alert("실패", e?.response?.data?.error || "마감 실패"); } } },
    ]);
  };

  // 메시지 전달
  const [forwardFor, setForwardFor] = useState<WorkMessage | null>(null);
  const [forwardChannels, setForwardChannels] = useState<WorkChannel[] | null>(null);
  const [forwardMembers, setForwardMembers] = useState<Member[]>([]);
  const [forwardSearch, setForwardSearch] = useState("");
  const openForward = async (m: WorkMessage) => {
    setReactionTarget(null);
    setForwardFor(m);
    setForwardChannels(null);
    setForwardSearch("");
    try {
      const [chs, mems] = await Promise.all([api.getChannels(), getMembers().catch(() => [])]);
      setForwardChannels(chs);
      setForwardMembers(mems);
    } catch {
      setForwardChannels([]);
    }
  };
  const doForward = async (targetId: string) => {
    if (!forwardFor) return;
    try {
      await forwardMessage(targetId, forwardFor);
      setForwardFor(null);
      Alert.alert("완료", "메시지를 전달했습니다.");
      if (targetId === channelId) load();
    } catch (e: any) {
      Alert.alert("실패", e?.response?.data?.error || "전달 중 오류가 발생했습니다.");
    }
  };
  // 구성원 선택 → DM 찾기/생성 후 전달
  const doForwardToMember = async (userId: string) => {
    try {
      const ch = await createChannel({ type: "DM", memberIds: [userId] });
      if (ch?.id) await doForward(ch.id);
    } catch (e: any) {
      Alert.alert("실패", e?.response?.data?.error || "대화방 생성 중 오류가 발생했습니다.");
    }
  };

  // 북마크 토글
  const onToggleBookmark = async (m: WorkMessage) => {
    setReactionTarget(null);
    try {
      const on = await toggleBookmark(m.id);
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, bookmarked: on } : x)));
    } catch {
      Alert.alert("오류", "보관함 처리 중 오류가 발생했습니다.");
    }
  };

  // 예약 전송 (전송 버튼 길게 누르기)
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("09:00");
  const [scheduledList, setScheduledList] = useState<ScheduledItem[] | null>(null);
  const openSchedule = async () => {
    // 예약 전송은 글만 지원 — 첨부가 대기 중이면 조용히 버려지지 않게 차단
    if (pendingAtts.length > 0) {
      Alert.alert("알림", "예약 전송은 글만 지원합니다.\n첨부는 전송 버튼으로 바로 보내주세요.");
      return;
    }
    const t = new Date(Date.now() + 60 * 60 * 1000);
    setScheduleDate(`${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`);
    setScheduleTime(`${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`);
    setScheduledList(null);
    setScheduleOpen(true);
    try { setScheduledList(await getScheduledMessages(channelId)); } catch { setScheduledList([]); }
  };
  const submitSchedule = async () => {
    if (!text.trim()) { Alert.alert("알림", "먼저 입력창에 보낼 메시지를 작성해주세요."); return; }
    if (!scheduleDate || !/^\d{2}:\d{2}$/.test(scheduleTime)) { Alert.alert("알림", "날짜와 시간을 확인해주세요. (시간은 HH:mm)"); return; }
    const at = new Date(`${scheduleDate}T${scheduleTime}:00`);
    if (isNaN(at.getTime()) || at.getTime() < Date.now() + 60 * 1000) { Alert.alert("알림", "예약 시간은 현재보다 이후여야 합니다."); return; }
    try {
      await createScheduledMessage(channelId, text.trim(), at.toISOString());
      setText("");
      setScheduleOpen(false);
      Alert.alert("완료", "메시지를 예약했습니다. 시간이 되면 자동으로 전송됩니다.");
    } catch (e: any) {
      Alert.alert("실패", e?.response?.data?.error || "예약 중 오류가 발생했습니다.");
    }
  };
  const removeScheduled = async (sid: string) => {
    try {
      await cancelScheduledMessage(sid);
      setScheduledList((prev) => (prev || []).filter((s) => s.id !== sid));
    } catch {
      Alert.alert("오류", "예약 취소 중 오류가 발생했습니다.");
    }
  };

  // 메시지 리마인더 (롱프레스 시트)
  const openReminder = (m: WorkMessage) => {
    setReactionTarget(null);
    const set = async (at: Date) => {
      try {
        await createReminder(m.id, at.toISOString());
        Alert.alert("완료", "리마인더를 등록했습니다. 시간이 되면 큐브티 봇이 알려드립니다.");
      } catch (e: any) {
        Alert.alert("실패", e?.response?.data?.error || "리마인더 등록 중 오류가 발생했습니다.");
      }
    };
    const t9 = new Date();
    t9.setDate(t9.getDate() + 1);
    t9.setHours(9, 0, 0, 0);
    Alert.alert("⏰ 이 메시지 다시 알림", "언제 다시 알려드릴까요?", [
      { text: "취소", style: "cancel" },
      { text: "1시간 후", onPress: () => set(new Date(Date.now() + 60 * 60 * 1000)) },
      { text: "내일 오전 9시", onPress: () => set(t9) },
    ]);
  };

  // 읽음/안읽음 명단
  const [readersOpen, setReadersOpen] = useState(false);
  const [readersData, setReadersData] = useState<{ read: ReaderEntry[]; unread: ReaderEntry[] } | null>(null);
  const [readersTab, setReadersTab] = useState<"unread" | "read">("unread");

  const openReaders = async (messageId: string) => {
    setReadersTab("unread");
    setReadersData(null);
    setReadersOpen(true);
    try {
      setReadersData(await getMessageReaders(messageId));
    } catch {
      setReadersOpen(false);
      Alert.alert("오류", "읽음 정보를 불러오지 못했습니다.");
    }
  };

  // 채팅방 메뉴(이름 변경/멤버 관리) + 각 모달
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatTitle, setChatTitle] = useState(route.params.name || "");
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberList, setMemberList] = useState<ChannelMemberInfo[]>([]);
  const [myId, setMyId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<string>("");
  const [myName, setMyName] = useState<string>("");

  // 멤버 추가 모달
  const [addOpen, setAddOpen] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set());
  const [selectedNew, setSelectedNew] = useState<Set<string>>(new Set());
  const [memberSearch, setMemberSearch] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  const addCandidates = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    return members.filter((m) => !existingIds.has(m.id) && (!q || m.name.toLowerCase().includes(q)));
  }, [members, existingIds, memberSearch]);

  // #4 알림 켜기/끄기 (ALL ↔ MUTE)
  const toggleNotify = async () => {
    const next = notify === "MUTE" ? "ALL" : "MUTE";
    setNotify(next);
    try {
      await setChannelNotify(channelId, next as any);
    } catch {
      setNotify(notify); // 실패 시 복원
    }
  };

  // 채팅방 이름 변경 (서버가 권한 검증 — 방장/관리자만 성공)
  const confirmRename = async () => {
    const name = renameVal.trim();
    if (!name) return;
    setRenaming(true);
    try {
      await renameChannel(channelId, name);
      setRenameOpen(false);
      setChatTitle(name);
      navigation.setOptions({ title: name });
      load();
    } catch (e: any) {
      Alert.alert("변경 실패", e?.response?.data?.error || "이름 변경 중 오류가 발생했습니다.");
    } finally {
      setRenaming(false);
    }
  };

  // 멤버 관리(목록 + 내보내기)
  const openMembers = async () => {
    setMembersOpen(true);
    try {
      setMemberList(await getChannelMembersList(channelId));
    } catch {
      Alert.alert("오류", "멤버 목록을 불러오지 못했습니다.");
    }
  };

  const kickMember = (m: ChannelMemberInfo) => {
    Alert.alert("내보내기", `${m.name}님을 채팅방에서 내보낼까요?`, [
      { text: "취소", style: "cancel" },
      {
        text: "내보내기",
        style: "destructive",
        onPress: async () => {
          try {
            await leaveChannel(channelId, m.userId);
            setMemberList((prev) => prev.filter((x) => x.userId !== m.userId));
          } catch (e: any) {
            Alert.alert("실패", e?.response?.data?.error || "내보내기 중 오류가 발생했습니다.");
          }
        },
      },
    ]);
  };

  // #5 멤버 추가
  const openAddMembers = async () => {
    setSelectedNew(new Set());
    setMemberSearch("");
    setAddOpen(true);
    try {
      const [all, existing] = await Promise.all([getMembers(), getChannelMemberIds(channelId)]);
      setMembers(all);
      setExistingIds(new Set(existing));
    } catch {
      Alert.alert("오류", "직원 목록을 불러오지 못했습니다.");
    }
  };

  const confirmAddMembers = async () => {
    const ids = Array.from(selectedNew);
    if (!ids.length) {
      setAddOpen(false);
      return;
    }
    setAddLoading(true);
    try {
      if (isGroup) {
        await addChannelMembers(channelId, ids);
        setAddOpen(false);
        Alert.alert("완료", `${ids.length}명을 초대했습니다.`);
        load();
      } else {
        // 1:1에서 초대 = 카톡처럼 새 그룹 채팅방 생성 (기존 1:1은 그대로 유지)
        const memberIds = [...Array.from(existingIds), ...ids];
        const invitedNames = members.filter((m) => ids.includes(m.id)).map((m) => m.name);
        const groupName = [chatTitle, ...invitedNames].slice(0, 3).join(", ") + (invitedNames.length > 2 ? ` 외 ${invitedNames.length - 2}명` : "");
        const ch = await createChannel({ name: groupName, type: "CHANNEL", memberIds });
        setAddOpen(false);
        navigation.push("WorkChat", { channelId: ch.id, name: ch.name, type: "CHANNEL" });
      }
    } catch (e: any) {
      Alert.alert("실패", e?.response?.data?.error || "멤버 추가 중 오류가 발생했습니다.");
    } finally {
      setAddLoading(false);
    }
  };

  // 헤더 우측: 알림 토글 + (그룹 채널만) 멤버 추가
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <TouchableOpacity onPress={() => { setSearchOpen((v) => !v); setSearchQuery(""); }}>
            <Ionicons name="search-outline" size={22} color={searchOpen ? "#4f46e5" : "#6b7280"} />
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleNotify}>
            <Ionicons
              name={notify === "MUTE" ? "notifications-off-outline" : "notifications-outline"}
              size={22}
              color={notify === "MUTE" ? "#9ca3af" : "#4f46e5"}
            />
          </TouchableOpacity>
          {/* 멤버 초대 — 1:1에서는 카톡처럼 새 그룹 채팅방을 만든다(기존 1:1 유지) */}
          <TouchableOpacity onPress={openAddMembers}>
            <Ionicons name="person-add-outline" size={22} color="#4f46e5" />
          </TouchableOpacity>
          {/* ⋮ 메뉴는 DM에도 표시 — 링크 모아보기·대화 숨기기는 1:1에서도 쓰인다 (항목별 분기는 메뉴 안에서) */}
          <TouchableOpacity onPress={() => setMenuOpen(true)}>
            <Ionicons name="ellipsis-vertical" size={20} color="#6b7280" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, notify, isGroup, searchOpen]);

  // inverted 채팅 리스트: 최신 메시지가 항상 하단에 고정된다(scrollToEnd 불필요).
  // 데이터는 최신이 앞(index 0)이어야 하므로 역순으로 뒤집는다.
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);
  // 채팅방 내 검색: 검색어 있으면 내용 일치 메시지만 표시
  const displayedMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return reversedMessages;
    return reversedMessages.filter((m) => !m.deleted && (m.content || "").toLowerCase().includes(q));
  }, [reversedMessages, searchQuery]);

  // 알림으로 들어왔을 때: 목록이 준비되면 그 메시지로 스크롤하고 3초간 강조.
  // 목록에 없으면(오래된 메시지) 스크롤은 건너뛴다 — 채팅방을 여는 것까지는 된다.
  useEffect(() => {
    if (!focusMessageId || focusedRef.current === focusMessageId) return;
    const idx = displayedMessages.findIndex((m) => m.id === focusMessageId);
    if (idx < 0) return;
    focusedRef.current = focusMessageId;
    setHighlightId(focusMessageId);
    // 렌더가 끝난 뒤 스크롤(측정 실패 시 근사 위치로 재시도)
    setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      } catch {
        listRef.current?.scrollToOffset({ offset: idx * 80, animated: true });
      }
    }, 350);
    const t = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(t);
  }, [focusMessageId, displayedMessages]);

  const load = useCallback(async () => {
    try {
      const { messages: m, notice: n } = await api.getMessagesFull(channelId);
      setMessages(m);
      setNotice(n);
    } catch (error) {
      console.error("❌ Failed to load messages:", error);
    } finally {
      setLoading(false);
    }
  }, [channelId]);

  useEffect(() => {
    load();
    api.markChannelRead(channelId).catch(() => {});
    // @멘션 자동완성용: 이 채널 구성원 로드
    getChannelMembersList(channelId).then(setChanMembers).catch(() => {});
    storage.getUser().then((u) => { setMyId(u?.id ?? null); setMyRole(u?.role ?? ""); setMyName(u?.name ?? ""); }).catch(() => {});
    // 간단한 실시간: 4초마다 폴링
    const timer = setInterval(load, 4000);
    // 타이핑 표시: 2초마다 폴링
    const typingTimer = setInterval(() => {
      getTypingUsers(channelId).then(setTypingUsers).catch(() => {});
    }, 2000);
    return () => {
      clearInterval(timer);
      clearInterval(typingTimer);
    };
  }, [load, channelId]);

  // 입력 중 마지막 토큰이 @로 시작하면 멘션 자동완성 쿼리 추출
  const onChangeText = (v: string) => {
    setText(v);
    const m = v.match(/@([가-힣A-Za-z0-9_]*)$/);
    setMentionQuery(m ? m[1] : null);
    // 타이핑 신호 (2초에 한 번만 전송)
    const now = Date.now();
    if (v && now - lastTypingPost.current > 2000) {
      lastTypingPost.current = now;
      postTyping(channelId).catch(() => {});
    }
  };
  const pickMention = (name: string) => {
    setText((cur) => cur.replace(/@([가-힣A-Za-z0-9_]*)$/, `@${name} `));
    setMentionQuery(null);
  };
  const mentionCands =
    mentionQuery !== null
      ? chanMembers.filter((m) => m.name.toLowerCase().includes(mentionQuery.toLowerCase()))
      : [];
  // "@전체" = 방 전체 멘션 (서버가 전원 멘션으로 처리)
  const mentionShowAll = mentionQuery !== null && "전체".includes(mentionQuery);

  const handleSend = async () => {
    const content = text.trim();
    const editing = editTarget;
    // 대기 첨부가 있으면 글 없이도 전송 가능 (수정 중에는 텍스트만)
    if (editing || pendingAtts.length === 0) {
      if (!content || sending) return;
      setSending(true);
      setText("");
      const replying = replyTarget;
      setEditTarget(null);
      setReplyTarget(null);
      try {
        if (editing) {
          await editMessage(editing.id, content);
          await load();
        } else {
          const msg = await sendTextMessage(channelId, content, replying?.id);
          setMessages((prev) => [...prev, msg]);
        }
      } catch (error) {
        console.error("❌ Failed to send:", error);
        setText(content); // 실패 시 입력 복원
        if (editing) setEditTarget(editing);
        if (replying) setReplyTarget(replying);
      } finally {
        setSending(false);
      }
      return;
    }
    // 대기 첨부 + (선택) 글 → 웹과 동일하게 발송: 사진 2장 이상은 앨범 묶음, 캡션·답장은 첫 메시지에
    if (sendingRef.current || sending || uploading) return; // 더블탭 중복 전송 방지 (ref는 즉시 반영)
    sendingRef.current = true;
    const atts = pendingAtts;
    const attachFirst = attachFirstRef.current;
    setSending(true);
    setUploading(true);
    try {
      let caption = content;
      let replyId: string | undefined = replyTarget?.id; // 캡션 유무와 무관하게 첫 메시지에 답장 연결
      const images = atts.filter((a) => a.kind === "image");
      const isAlbum = images.length >= 2;
      if (isAlbum) {
        const urls: string[] = [];
        for (const a of images.slice(0, 10)) {
          const up = await uploadFile({ uri: a.uri, name: a.name, mimeType: a.mimeType || undefined }, makeProgressHandler());
          urls.push(up.fileUrl);
        }
        clearProgress();
        await sendAlbumMessage(channelId, urls, { content: caption, attachFirst, replyToId: replyId });
        caption = ""; replyId = undefined;
        // 전송 성공분은 즉시 대기 목록에서 제거 — 부분 실패 후 재전송 시 중복 방지
        setPendingAtts((prev) => prev.filter((p) => p.kind !== "image"));
        setText("");
      }
      const singles = isAlbum ? atts.filter((a) => a.kind !== "image") : atts;
      for (const a of singles) {
        const up = await uploadFile({ uri: a.uri, name: a.name, mimeType: a.mimeType || undefined }, makeProgressHandler());
        clearProgress();
        await sendFileMessage(channelId, { fileUrl: up.fileUrl, fileName: up.fileName, fileType: up.fileType }, { content: caption, attachFirst, replyToId: replyId });
        caption = ""; replyId = undefined;
        setPendingAtts((prev) => prev.filter((p) => p !== a));
        setText("");
      }
      attachFirstRef.current = false;
      setReplyTarget(null);
      await load();
    } catch (error: any) {
      // 이미 전송된 분량을 화면에 반영 — 안 간 줄 알고 전부 재전송하는 것을 방지
      await load().catch(() => {});
      Alert.alert("전송 실패", (error?.response?.data?.error || error?.message || "전송 중 오류가 발생했습니다.") + "\n남은 첨부는 유지됩니다. 전송을 다시 눌러주세요.");
    } finally {
      setSending(false);
      setUploading(false);
      clearProgress();
      sendingRef.current = false;
    }
  };

  const startReply = (m: WorkMessage) => { setReplyTarget(m); setEditTarget(null); setReactionTarget(null); };
  const startEdit = (m: WorkMessage) => {
    setReactionTarget(null);
    // 대기 첨부·작성 중 캡션이 있으면 수정 진입 차단 (수정 저장이 첨부를 삼키거나 캡션을 덮어쓰는 것 방지)
    if (pendingAtts.length > 0) {
      Alert.alert("알림", "첨부 대기 중에는 메시지를 수정할 수 없습니다.\n첨부를 먼저 보내거나 삭제해주세요.");
      return;
    }
    setEditTarget(m); setReplyTarget(null); setText(m.content);
  };
  const confirmDelete = (m: WorkMessage) => {
    setReactionTarget(null);
    Alert.alert("메시지 삭제", "이 메시지를 삭제할까요?", [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: async () => { try { await deleteMessage(m.id); load(); } catch (e: any) { Alert.alert("오류", e?.response?.data?.error || "삭제 실패"); } } },
    ]);
  };

  // ── 음성 메시지 녹음 (expo-audio) ──
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopRecTimer = () => {
    if (recTimer.current) { clearInterval(recTimer.current); recTimer.current = null; }
  };
  useEffect(() => () => stopRecTimer(), []);

  const startRecording = async () => {
    if (uploading || recording || editTarget) return; // 수정 중 음성 전송은 혼선 방지
    const { granted } = await requestRecordingPermissionsAsync();
    if (!granted) {
      Alert.alert("마이크 권한 필요", "설정에서 마이크 접근을 허용해주세요.");
      return;
    }
    try {
      // 무음 모드에서도 재생되도록 + 녹음 허용
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync(); // record() 전 필수
      recorder.record();
      setRecording(true);
      setRecSec(0);
      recTimer.current = setInterval(() => setRecSec((s) => s + 1), 1000);
    } catch (e: any) {
      Alert.alert("녹음 실패", e?.message || "녹음을 시작하지 못했습니다.");
    }
  };

  // send=false면 녹음을 버리고 취소
  const finishRecording = async (send: boolean) => {
    stopRecTimer();
    setRecording(false);
    let uri: string | null = null;
    try {
      await recorder.stop();
      uri = recorder.uri;
      // 재생 전용으로 오디오 모드 복귀 (iOS: 녹음 모드로 두면 재생 볼륨이 작아짐)
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
    } catch {
      /* 정지 실패는 무시 — 아래에서 uri 없으면 종료 */
    }
    if (!send || !uri) return;
    if (recSec < 1) { Alert.alert("녹음이 너무 짧습니다", "1초 이상 녹음해주세요."); return; }
    setUploading(true);
    try {
      await uploadAndSend({ uri, name: `voice_${Date.now()}.m4a`, mimeType: "audio/m4a" });
    } catch (error: any) {
      Alert.alert("전송 실패", error?.response?.data?.error || error?.message || "음성 메시지를 보내지 못했습니다.");
    } finally {
      setUploading(false);
      clearProgress();
    }
  };

  // 진행률 콜백 — %와 남은 시간(경과 시간 기반 추정) 갱신
  const makeProgressHandler = () => {
    const started = Date.now();
    return (pct: number) => {
      setUploadPct(pct);
      if (pct > 0 && pct < 100) {
        const elapsed = (Date.now() - started) / 1000;
        setUploadEtaSec(Math.ceil((elapsed / pct) * (100 - pct)));
      } else {
        setUploadEtaSec(null);
      }
    };
  };
  const clearProgress = () => { setUploadPct(null); setUploadEtaSec(null); };

  // 업로드 + 메시지 전송 (단일 파일)
  const uploadAndSend = async (file: { uri: string; name: string; mimeType?: string | null }) => {
    try {
      const uploaded = await uploadFile(file, makeProgressHandler());
      const msg = await sendFileMessage(channelId, uploaded);
      setMessages((prev) => [...prev, msg]);
    } finally {
      clearProgress();
    }
  };

  // 파일(문서) 첨부 — 다중 선택 → 대기 첨부로 추가 (전송 버튼에서 발송)
  const handleAttach = async () => {
    if (uploading || sending) return;
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (result.canceled) return;
      const assets = result.assets ?? [];
      // 파일 선택기로 사진/영상을 골라도 종류를 판별해 사진 10장 제한·앨범 묶음이 동일하게 적용되게
      addPending(assets.map((a) => {
        const kind = kindOf(a.name, a.mimeType);
        return { uri: a.uri, name: kind === "image" ? normalizeImageName(a.name, a.mimeType) : a.name, mimeType: a.mimeType ?? null, kind };
      }));
    } catch (error: any) {
      Alert.alert("첨부 실패", error?.message || "파일 선택 중 오류가 발생했습니다.");
    }
  };

  // 사진 첨부 — 갤러리 다중 선택 → 대기 첨부로 추가 (전송 버튼에서 발송)
  const handlePickImage = async () => {
    if (uploading || sending) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images", "videos"],
        allowsMultipleSelection: true,
        quality: 0.8,
        // iOS: 4K 영상을 기기에서 1080p H.264로 변환한 뒤 업로드 → 용량·업로드 시간 대폭 절감
        // (Android는 미지원 옵션이라 원본 업로드 → 서버 압축이 처리)
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1920x1080,
      });
      if (result.canceled) return;
      const assets = result.assets ?? [];
      const now = Date.now();
      addPending(assets.map((a, i) => {
        const kind = (a.type === "video" ? "video" : "image") as "video" | "image";
        const mime = a.mimeType || (kind === "video" ? "video/mp4" : "image/jpeg");
        let name = a.fileName || (kind === "video" ? `video_${now}_${i}.mp4` : `photo_${now}_${i}.jpg`);
        if (kind === "image") name = normalizeImageName(name, mime); // HEIC 등 → 서버 확장자 판별과 일치
        return { uri: a.uri, name, mimeType: mime, kind };
      }));
    } catch (error: any) {
      Alert.alert("첨부 실패", error?.message || "사진 선택 중 오류가 발생했습니다.");
    }
  };

  const react = async (messageId: string, emoji: string) => {
    try {
      await toggleReaction(messageId, emoji);
      await load();
    } catch (error) {
      console.error("❌ Failed to react:", error);
    }
  };

  // 채팅방의 모든 사진(앨범 포함, 시간순)을 모아 탭한 사진부터 스와이프로 넘겨 본다
  const openImageViewer = (messageId: string, urlIndex: number, tappedUrl: string) => {
    const keys: string[] = [];
    const urls: string[] = [];
    for (const m of messages) {
      if (m.deleted) continue;
      if (m.albumUrls && m.albumUrls.length > 0) m.albumUrls.forEach((u, i) => { keys.push(`${m.id}#${i}`); urls.push(u); });
      else if (m.fileType === "image" && m.fileUrl) { keys.push(`${m.id}#0`); urls.push(m.fileUrl); }
    }
    const idx = keys.indexOf(`${messageId}#${urlIndex}`);
    // 목록에서 못 찾으면(폴링 레이스 등) 탭한 사진 한 장만이라도 정확히 보여준다
    if (idx < 0) { setViewerIndex(0); setImageViewer({ urls: [tappedUrl], keys: [`${messageId}#${urlIndex}`], index: 0 }); return; }
    setViewerIndex(idx);
    setImageViewer({ urls, keys, index: idx });
  };

  // 사진 저장 — 사진 보관함 권한(최초 1회 요청) 후 캐시로 내려받아 사진첩에 자동 저장 (iOS·Android 공통)
  const downloadImages = async (urls: string[]) => {
    if (downloading) return;
    setDownloading(true);
    let saved = 0;
    try {
      // writeOnly=true: "사진 추가" 권한만 요청(보관함 열람 권한 불필요)
      const perm = await MediaLibrary.requestPermissionsAsync(true);
      if (!perm.granted) {
        Alert.alert("권한 필요", "사진을 저장하려면 설정에서 큐브티의 사진 접근을 허용해주세요.");
        setDownloading(false);
        return;
      }
      for (const u of urls) {
        const filename = u.split("/").pop()?.split("?")[0] || `photo-${Date.now()}.jpg`;
        const dl = await FileSystem.downloadAsync(FILE_ORIGIN + u, `${FileSystem.cacheDirectory}${filename}`);
        await MediaLibrary.saveToLibraryAsync(dl.uri);
        saved++;
      }
      Alert.alert("저장 완료", `사진 ${saved}장을 사진첩에 저장했습니다.`);
    } catch {
      Alert.alert("오류", saved > 0 ? `${saved}장 저장 후 오류가 발생했습니다.` : "사진 저장에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  };

  // 뷰어 다운로드 버튼 — 현재 사진이 묶음(앨범) 소속이면 한 장/전체 선택
  const onViewerDownload = () => {
    if (!imageViewer || downloading) return;
    const idx = Math.min(viewerIndex, imageViewer.urls.length - 1);
    const curUrl = imageViewer.urls[idx];
    const msgId = imageViewer.keys[idx]?.split("#")[0];
    const msg = messages.find((m) => m.id === msgId);
    const album = msg?.albumUrls && msg.albumUrls.length > 1 ? msg.albumUrls : null;
    if (album) {
      Alert.alert("사진 저장", `묶음 사진 ${album.length}장 중에서`, [
        { text: "이 사진만", onPress: () => downloadImages([curUrl]) },
        { text: `전체 ${album.length}장`, onPress: () => downloadImages(album) },
        { text: "취소", style: "cancel" },
      ]);
    } else {
      downloadImages([curUrl]);
    }
  };

  const renderItem = ({ item, index }: { item: WorkMessage; index: number }) => {
    // 일자별 날짜 구분선 — inverted 리스트(index 0=최신)라 "더 오래된 이웃(index+1)"과
    // 날짜가 다르면 이 메시지가 그 날의 첫 메시지 → 말풍선 위에 구분선 표시
    const older = displayedMessages[index + 1];
    const showDate = !older || new Date(item.createdAt).toDateString() !== new Date(older.createdAt).toDateString();
    const d = new Date(item.createdAt);
    const dateDivider = showDate ? (
      <View style={styles.dateDividerRow}>
        <View style={styles.dateDividerLine} />
        <Text style={styles.dateDividerText}>
          {`${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${["일", "월", "화", "수", "목", "금", "토"][d.getDay()]}요일`}
        </Text>
        <View style={styles.dateDividerLine} />
      </View>
    ) : null;
    // 시스템 알림(이름 변경 등): 중앙 회색 문구
    if (item.system) {
      return (
        <View>
          {dateDivider}
          <View style={styles.systemRow}>
            <Text style={styles.systemText}>{item.content}</Text>
          </View>
        </View>
      );
    }
    const reactions = (item.reactions as any[]) || [];
    const body = (
      <View style={[styles.row, item.mine ? styles.rowMine : styles.rowOther, highlightId === item.id && styles.rowHighlight]}>
        {!item.mine && <Text style={styles.sender}>{item.userName}{item.userBranch ? ` · ${item.userBranch}` : ""}</Text>}
        <Pressable
          onLongPress={() => !item.deleted && setReactionTarget(item.id)}
          style={[
            styles.bubble,
            item.mine ? styles.bubbleMine : styles.bubbleOther,
            !item.deleted && item.fileType === "image" && styles.bubbleImage,
            // 이모지 단독 메시지는 배경 투명 (bubbleMine/Other 배경을 마지막에 덮어씀)
            !item.deleted && !item.poll && !item.fileUrl && !(item.albumUrls && item.albumUrls.length) && !item.replyTo && !!item.content && isEmojiOnly(item.content) && styles.bubbleEmoji,
          ]}
        >
          {item.deleted ? (
            <Text style={[styles.msgText, item.mine && styles.msgTextMine, styles.deletedText]}>삭제된 메시지입니다</Text>
          ) : (
            <>
              {item.replyTo && (
                <View style={styles.quoteBox}>
                  <Text style={styles.quoteName}>{item.replyTo.userName}</Text>
                  <Text style={styles.quoteText} numberOfLines={1}>{item.replyTo.deleted ? "삭제된 메시지" : item.replyTo.content}</Text>
                </View>
              )}
              {item.poll ? (
                <View style={styles.pollCard}>
                  <Text style={[styles.pollQ, item.mine && { color: "#fff" }]}>📊 {item.poll.question}</Text>
                  {item.poll.options.map((opt, i) => {
                    const cnt = item.poll!.counts[i] || 0;
                    const total = Math.max(...item.poll!.counts, 1);
                    const mineVote = item.poll!.myVotes.includes(i);
                    return (
                      <TouchableOpacity key={i} disabled={item.poll!.closed} onPress={() => onVote(item.poll!.id, i)}
                        onLongPress={() => setReactionTarget(item.id)}
                        style={[styles.pollOpt, mineVote && styles.pollOptOn]}>
                        <View style={[styles.pollFill, { width: `${(cnt / total) * 100}%` as any }, mineVote && { backgroundColor: "#c7d2fe" }]} />
                        <View style={styles.pollOptRow}>
                          <Text style={styles.pollOptText} numberOfLines={1}>{mineVote ? "✓ " : ""}{opt}</Text>
                          <Text style={styles.pollCnt}>{cnt}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  <View style={styles.pollFoot}>
                    <Text style={[styles.pollMeta, item.mine && { color: "#c7d2fe" }]}>
                      {item.poll.totalVoters}명 참여{item.poll.multiple ? " · 복수선택" : ""}{item.poll.closed ? " · 마감됨" : (item.poll as any).closesAt ? ` · ${new Date((item.poll as any).closesAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })} 마감` : ""}
                    </Text>
                    {!item.poll.closed && (item.poll.creatorId === myId || myRole === "ADMIN" || myRole === "MANAGER") && (
                      <TouchableOpacity onPress={() => onClosePoll(item.poll!.id)}>
                        <Text style={[styles.pollClose, item.mine && { color: "#c7d2fe" }]}>마감</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ) : (
                <>
                  {/* 작성 순서대로: 글을 먼저 썼으면 글 위·첨부 아래, 첨부를 먼저 붙였으면(attachFirst) 첨부 위·글 아래 */}
                  {!!item.content && !item.attachFirst && (() => {
                  const hasAttach = !!item.fileUrl || !!(item.albumUrls && item.albumUrls.length > 0);
                  // 이모지만 보낸 메시지는 크게 (카톡식)
                  if (!hasAttach && isEmojiOnly(item.content)) {
                    return <Text style={styles.jumboEmoji}>{item.content.trim()}</Text>;
                  }
                  // 긴 글은 접어서 보여주고 "전체 보기"로 펼친다 (카톡식)
                  const contentLines = item.content.split("\n");
                  const isLong = item.content.length > 500 || contentLines.length > 12;
                  const expanded = expandedMsgs.has(item.id);
                  const shown = !isLong || expanded
                    ? item.content
                    : (contentLines.length > 12 ? contentLines.slice(0, 12).join("\n") : item.content).slice(0, 500) + " …";
                  return (
                    <>
                      <Text style={[styles.msgText, item.mine && styles.msgTextMine]}>
                        {shown.split(/(@[가-힣A-Za-z0-9_]+|https?:\/\/[^\s]+)/g).map((p, i) =>
                          p.startsWith("@")
                            ? <Text key={i} style={[styles.mentionText, item.mine && styles.mentionTextMine]}>{p}</Text>
                            : /^https?:\/\//.test(p)
                            ? <Text key={i} style={[styles.linkInText, item.mine && styles.linkInTextMine]} onPress={() => Linking.openURL(p)}>{p}</Text>
                            : p
                        )}
                        {item.editedAt ? <Text style={[styles.editedTag, item.mine && styles.editedTagMine]}> (수정됨)</Text> : null}
                      </Text>
                      {isLong && !expanded ? (
                        <TouchableOpacity
                          onPress={() => setExpandedMsgs((prev) => { const n = new Set(prev); n.add(item.id); return n; })}
                          style={[styles.expandBtn, item.mine && styles.expandBtnMine]}
                        >
                          <Text style={[styles.expandBtnText, item.mine && styles.expandBtnTextMine]}>전체 보기</Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  );
                  })()}
                  <View style={!!item.content && !item.attachFirst && (item.fileUrl || (item.albumUrls && item.albumUrls.length > 0)) ? styles.attachBelowText : undefined}>
                  {item.albumUrls && item.albumUrls.length > 0 ? (
                    <View style={styles.albumGrid}>
                      {item.albumUrls.slice(0, 9).map((u, i) => {
                        const shown = Math.min(item.albumUrls!.length, 9);
                        const rest = item.albumUrls!.length - shown;
                        return (
                          <TouchableOpacity key={i} onPress={() => openImageViewer(item.id, i, u)} onLongPress={() => setReactionTarget(item.id)}>
                            <Image source={{ uri: FILE_ORIGIN + u }} style={styles.albumCell} resizeMode="cover" />
                            {i === shown - 1 && rest > 0 ? (
                              <View style={styles.albumMore}><Text style={styles.albumMoreText}>+{rest}</Text></View>
                            ) : null}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  ) : item.fileUrl ? (
                    item.fileType === "image" ? (
                      <BubbleImage
                        uri={FILE_ORIGIN + item.fileUrl}
                        onPress={() => openImageViewer(item.id, 0, item.fileUrl!)}
                        onLongPress={() => setReactionTarget(item.id)}
                      />
                    ) : item.fileType === "video" ? (
                      <VideoBubble uri={FILE_ORIGIN + item.fileUrl} />
                    ) : item.fileType === "audio" ? (
                      <VoiceBubble uri={FILE_ORIGIN + item.fileUrl} mine={item.mine} />
                    ) : (
                      <TouchableOpacity onPress={() => Linking.openURL(FILE_ORIGIN + item.fileUrl)} onLongPress={() => setReactionTarget(item.id)}>
                        <Text style={[styles.msgText, item.mine && styles.msgTextMine]}>📎 {item.fileName || "첨부파일"}</Text>
                      </TouchableOpacity>
                    )
                  ) : null}
                  </View>
                  {!!item.content && !!item.attachFirst && (() => {
                  const hasAttach = !!item.fileUrl || !!(item.albumUrls && item.albumUrls.length > 0);
                  // 이모지만 보낸 메시지는 크게 (카톡식)
                  if (!hasAttach && isEmojiOnly(item.content)) {
                    return <Text style={styles.jumboEmoji}>{item.content.trim()}</Text>;
                  }
                  // 긴 글은 접어서 보여주고 "전체 보기"로 펼친다 (카톡식)
                  const contentLines = item.content.split("\n");
                  const isLong = item.content.length > 500 || contentLines.length > 12;
                  const expanded = expandedMsgs.has(item.id);
                  const shown = !isLong || expanded
                    ? item.content
                    : (contentLines.length > 12 ? contentLines.slice(0, 12).join("\n") : item.content).slice(0, 500) + " …";
                  return (
                    <>
                      <Text style={[styles.msgText, item.mine && styles.msgTextMine, hasAttach && styles.captionText]}>
                        {shown.split(/(@[가-힣A-Za-z0-9_]+|https?:\/\/[^\s]+)/g).map((p, i) =>
                          p.startsWith("@")
                            ? <Text key={i} style={[styles.mentionText, item.mine && styles.mentionTextMine]}>{p}</Text>
                            : /^https?:\/\//.test(p)
                            ? <Text key={i} style={[styles.linkInText, item.mine && styles.linkInTextMine]} onPress={() => Linking.openURL(p)}>{p}</Text>
                            : p
                        )}
                        {item.editedAt ? <Text style={[styles.editedTag, item.mine && styles.editedTagMine]}> (수정됨)</Text> : null}
                      </Text>
                      {isLong && !expanded ? (
                        <TouchableOpacity
                          onPress={() => setExpandedMsgs((prev) => { const n = new Set(prev); n.add(item.id); return n; })}
                          style={[styles.expandBtn, item.mine && styles.expandBtnMine]}
                        >
                          <Text style={[styles.expandBtnText, item.mine && styles.expandBtnTextMine]}>전체 보기</Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  );
                  })()}
                </>
              )}
            </>
          )}
        </Pressable>

        {!item.deleted && !item.fileUrl && firstUrl(item.content) ? (
          <LinkPreview url={firstUrl(item.content)!} mine={item.mine} />
        ) : null}

        {reactions.length > 0 && (
          <View style={[styles.reactions, item.mine ? { justifyContent: "flex-end" } : undefined]}>
            {reactions.map((r) => (
              <TouchableOpacity
                key={r.emoji}
                style={[styles.reactionChip, r.mine && styles.reactionChipMine]}
                onPress={() => react(item.id, r.emoji)}
                onLongPress={() => r.names?.length && Alert.alert(`${r.emoji} ${r.count}명`, r.names.join("\n"))}
              >
                <Text style={styles.reactionText}>{r.emoji} {r.count}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={[styles.metaRow, item.mine ? { justifyContent: "flex-end" } : undefined]}>
          {!item.deleted && item.unreadBy ? (
            <TouchableOpacity onPress={() => openReaders(item.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
              <Text style={styles.unreadCount}>{item.unreadBy}</Text>
            </TouchableOpacity>
          ) : null}
          <Text style={styles.time}>
            {new Date(item.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
          </Text>
        </View>
      </View>
    );
    if (item.mine) return (
      <View>
        {dateDivider}
        {body}
      </View>
    );
    return (
      <View>
        {dateDivider}
        <View style={styles.otherRow}>
          <Avatar name={item.userName} size={34} uri={item.userAvatar} />
          <View style={styles.otherBody}>{body}</View>
        </View>
      </View>
    );
  };

  return (
    <>
    <KeyboardAvoidingView
      style={styles.container}
      behavior="padding"
      keyboardVerticalOffset={kbOffset}
    >
      {searchOpen && (
        <View style={styles.chatSearchBar}>
          <Ionicons name="search" size={16} color="#9ca3af" />
          <TextInput
            style={styles.chatSearchInput}
            placeholder="이 채팅방에서 검색"
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoFocus
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <Ionicons name="close-circle" size={18} color="#9ca3af" />
            </TouchableOpacity>
          ) : null}
        </View>
      )}
      {/* 채널 고정 공지 — X 는 나에게만 숨김, 전체 내리기는 관리자·등록자만 */}
      {notice && !noticeHidden && (
        <View style={[styles.noticeBar, notice.important && styles.noticeBarImportant]}>
          <Text style={styles.noticePin}>📌</Text>
          {notice.important ? (
            <View style={styles.noticeImpBadge}><Text style={styles.noticeImpBadgeText}>중요</Text></View>
          ) : null}
          {/* 본문 탭=펼치기만 (펼친 뒤 스크롤 중 실수로 접히지 않게, 접기는 ∧ 버튼) */}
          <TouchableOpacity style={{ flex: 1 }} onPress={() => noticeCollapsed && setNoticeCollapsed(false)} activeOpacity={0.7} disabled={!noticeCollapsed}>
            {/* 펼쳐도 화면 일부까지만 — 넘치면 내부 스크롤 */}
            <ScrollView style={noticeCollapsed ? undefined : { maxHeight: 280 }} nestedScrollEnabled scrollEnabled={!noticeCollapsed}>
              {notice.content ? (
                <Text style={styles.noticeText} numberOfLines={noticeCollapsed ? 1 : undefined}>{notice.content}</Text>
              ) : noticeCollapsed ? (
                <Text style={styles.noticeText}>🖼️ 이미지 공지</Text>
              ) : null}
              {notice.imageUrl && !noticeCollapsed ? (
                <TouchableOpacity onPress={() => Linking.openURL(FILE_ORIGIN + notice.imageUrl)}>
                  <Image source={{ uri: FILE_ORIGIN + notice.imageUrl }} style={styles.noticeImage} resizeMode="cover" />
                </TouchableOpacity>
              ) : null}
            </ScrollView>
            {!noticeCollapsed ? (
              <View style={styles.noticeMetaRow}>
                {notice.by ? <Text style={styles.noticeBy}>{notice.by} 등록</Text> : null}
                {(notice.unreadCount ?? 0) > 0 ? (
                  <TouchableOpacity onPress={openNoticeReaders}>
                    <Text style={styles.noticeUnreadBtn}>미확인 {notice.unreadCount}명</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setNoticeCollapsed((v) => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginRight: 8 }}>
            <Ionicons name={noticeCollapsed ? "chevron-down" : "chevron-up"} size={16} color="#b45309" />
          </TouchableOpacity>
          {(myRole === "ADMIN" || (notice.by && notice.by === myName)) && (
            <TouchableOpacity onPress={removeNotice} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginRight: 8 }}>
              <Ionicons name="trash-outline" size={15} color="#dc2626" />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={hideNoticeForMe} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={16} color="#b45309" />
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>첫 메시지를 보내보세요.</Text>
        </View>
      ) : searchQuery.trim() && displayedMessages.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.empty}>검색 결과가 없습니다.</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={displayedMessages}
          inverted
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          // 아직 그려지지 않은 위치로 스크롤하면 예외가 난다 — 근사 위치로 보낸 뒤 다시 시도
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
            setTimeout(() => {
              try { listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 }); } catch { /* 무시 */ }
            }, 400);
          }}
        />
      )}

      {/* 타이핑 표시 */}
      {typingUsers.length > 0 && (
        <View style={styles.typingBar}>
          <Text style={styles.typingText}>
            {typingUsers.length === 1
              ? `${typingUsers[0]}님이 입력 중…`
              : `${typingUsers.slice(0, 2).join(", ")}님이 입력 중…`}
          </Text>
        </View>
      )}

      {/* 업로드 진행률 (% + 남은 시간) */}
      {uploadPct !== null && (
        <View style={styles.uploadBar}>
          <View style={styles.uploadTrack}>
            <View style={[styles.uploadFill, { width: `${uploadPct}%` }]} />
          </View>
          <Text style={styles.uploadText}>
            업로드 중 {uploadPct}%
            {uploadEtaSec != null
              ? ` · 약 ${uploadEtaSec >= 60 ? `${Math.floor(uploadEtaSec / 60)}분 ${uploadEtaSec % 60}초` : `${uploadEtaSec}초`} 남음`
              : ""}
          </Text>
        </View>
      )}

      {/* 클립보드 이미지 감지 칩 */}
      {clipHasImage && !uploading && (
        <View style={styles.clipBarWrap}>
          <TouchableOpacity style={styles.clipBar} onPress={pasteClipboardImage}>
            <Ionicons name="clipboard-outline" size={15} color="#4f46e5" />
            <Text style={styles.clipBarText}>클립보드 이미지 붙여넣기</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setClipHasImage(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      )}

      {/* 답장/수정 미리보기 */}
      {(replyTarget || editTarget) && (
        <View style={styles.replyBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.replyBarTitle}>
              {editTarget ? "메시지 수정 중" : `${replyTarget?.userName}님에게 답장`}
            </Text>
            <Text style={styles.replyBarText} numberOfLines={1}>
              {(editTarget || replyTarget)?.content || "첨부파일"}
            </Text>
          </View>
          <TouchableOpacity onPress={() => { const wasEdit = !!editTarget; setReplyTarget(null); setEditTarget(null); if (wasEdit) setText(""); }}>
            <Ionicons name="close" size={20} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      )}

      {/* @멘션 자동완성 (채널 구성원만, 전원 표시 + 스크롤) */}
      {mentionQuery !== null && (mentionCands.length > 0 || mentionShowAll) && (
        <View style={styles.mentionBox}>
          <ScrollView style={{ maxHeight: 250 }} keyboardShouldPersistTaps="handled">
            {mentionShowAll && (
              <TouchableOpacity style={styles.mentionRow} onPress={() => pickMention("전체")}>
                <Ionicons name="megaphone-outline" size={15} color="#4f46e5" />
                <Text style={[styles.mentionName, { color: "#4f46e5" }]}>전체</Text>
                <Text style={styles.mentionBranch}> · 방 전체 알림</Text>
              </TouchableOpacity>
            )}
            {mentionCands.map((m) => (
              <TouchableOpacity key={m.userId} style={styles.mentionRow} onPress={() => pickMention(m.name)}>
                <Ionicons name="at" size={15} color="#4f46e5" />
                <Text style={styles.mentionName}>{m.name}</Text>
                {m.branch ? <Text style={styles.mentionBranch}> · {m.branch}</Text> : null}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

      {/* 대기 첨부 미리보기 — X로 제거, 전송 버튼으로 글과 함께 발송 */}
      {pendingAtts.length > 0 && !recording && (
        <View style={styles.pendingBar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {pendingAtts.map((p, i) => (
              <View key={`${p.uri}-${i}`} style={styles.pendingItem}>
                {p.kind === "image" ? (
                  <Image source={{ uri: p.uri }} style={styles.pendingThumb} />
                ) : (
                  <View style={styles.pendingFileBox}>
                    <Ionicons name={p.kind === "video" ? "videocam" : "document-text"} size={20} color="#4f46e5" />
                    <Text style={styles.pendingFileName} numberOfLines={2}>{p.name}</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={styles.pendingRemove}
                  onPress={() => setPendingAtts((prev) => prev.filter((_, idx) => idx !== i))}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <Ionicons name="close" size={12} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {recording ? (
        /* 녹음 중 — 입력바를 녹음 바로 교체 (취소 / 전송) */
        <View style={styles.inputBar}>
          <TouchableOpacity style={styles.attachBtn} onPress={() => finishRecording(false)}>
            <Ionicons name="trash-outline" size={22} color="#ef4444" />
          </TouchableOpacity>
          <View style={styles.recBar}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>녹음 중 {Math.floor(recSec / 60)}:{String(recSec % 60).padStart(2, "0")}</Text>
          </View>
          <TouchableOpacity style={styles.sendBtn} onPress={() => finishRecording(true)}>
            <Ionicons name="send" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      ) : (
      <View style={styles.inputBar}>
        <TouchableOpacity style={styles.attachBtn} onPress={handlePickImage} disabled={uploading}>
          <Ionicons name="image-outline" size={26} color="#4f46e5" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.attachBtn} onPress={handleAttach} disabled={uploading}>
          {uploading ? (
            <ActivityIndicator size="small" color="#4f46e5" />
          ) : (
            <Ionicons name="document-outline" size={24} color="#4f46e5" />
          )}
        </TouchableOpacity>
        <TouchableOpacity style={styles.attachBtn} onPress={() => setPollOpen(true)}>
          <Ionicons name="stats-chart-outline" size={22} color="#4f46e5" />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          placeholder="메시지 입력... (@로 멘션)"
          value={text}
          onChangeText={onChangeText}
          onFocus={checkClipboard}
          multiline
        />
        {/* 입력 내용/대기 첨부가 없으면 마이크(음성 메시지), 있으면 전송 */}
        {text.trim() || pendingAtts.length > 0 ? (
          <TouchableOpacity
            style={[styles.sendBtn, sending && styles.sendBtnDisabled]}
            onPress={handleSend}
            onLongPress={() => { if (text.trim()) openSchedule(); }}
            disabled={sending}
          >
            <Ionicons name="send" size={20} color="#fff" />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.micBtn} onPress={startRecording} disabled={uploading}>
            <Ionicons name="mic" size={20} color="#4f46e5" />
          </TouchableOpacity>
        )}
      </View>
      )}
    </KeyboardAvoidingView>

      {/* 롱프레스: 리액션 + 답장/수정/삭제. Modal은 키보드 대응을 위해 KeyboardAvoidingView 바깥에 둔다
          (안에 두면 검색 입력 포커스로 키보드가 뜰 때 모달이 닫히는 안드로이드 현상 발생) */}
      <Modal visible={!!reactionTarget} transparent animationType="fade" onRequestClose={() => setReactionTarget(null)}>
        <Pressable style={styles.modalBg} onPress={() => setReactionTarget(null)}>
          <Pressable style={styles.actionSheet} onPress={() => {}}>
            <View style={emojiMore ? styles.emojiGrid : styles.emojiBar}>
              {(emojiMore ? EMOJIS_ALL : EMOJIS).map((e) => (
                <TouchableOpacity
                  key={e}
                  style={emojiMore ? styles.emojiGridCell : undefined}
                  onPress={() => {
                    const t = reactionTarget;
                    setReactionTarget(null);
                    if (t) react(t, e);
                  }}
                >
                  <Text style={styles.emojiBig}>{e}</Text>
                </TouchableOpacity>
              ))}
              {!emojiMore && (
                <TouchableOpacity onPress={() => setEmojiMore(true)}>
                  <View style={styles.emojiMoreBtn}><Ionicons name="add" size={20} color="#6b7280" /></View>
                </TouchableOpacity>
              )}
            </View>
            {(() => {
              const t = messages.find((m) => m.id === reactionTarget);
              if (!t) return null;
              return (
                <View style={styles.actionRow}>
                  <TouchableOpacity style={styles.actionItem} onPress={() => startReply(t)}>
                    <Ionicons name="arrow-undo-outline" size={22} color="#374151" />
                    <Text style={styles.actionLabel}>답장</Text>
                  </TouchableOpacity>
                  {!t.poll && !!t.content && (
                    <TouchableOpacity
                      style={styles.actionItem}
                      onPress={async () => {
                        setReactionTarget(null);
                        await Clipboard.setStringAsync(t.content);
                        if (Platform.OS === "android") ToastAndroid.show("복사되었습니다", ToastAndroid.SHORT);
                      }}
                    >
                      <Ionicons name="copy-outline" size={22} color="#374151" />
                      <Text style={styles.actionLabel}>복사</Text>
                    </TouchableOpacity>
                  )}
                  {!t.poll && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => openForward(t)}>
                      <Ionicons name="arrow-redo-outline" size={22} color="#374151" />
                      <Text style={styles.actionLabel}>전달</Text>
                    </TouchableOpacity>
                  )}
                  {!t.poll && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => onToggleBookmark(t)}>
                      <Ionicons name={t.bookmarked ? "star" : "star-outline"} size={22} color={t.bookmarked ? "#f59e0b" : "#374151"} />
                      <Text style={styles.actionLabel}>{t.bookmarked ? "보관해제" : "보관"}</Text>
                    </TouchableOpacity>
                  )}
                  {!t.poll && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => openReminder(t)}>
                      <Ionicons name="alarm-outline" size={22} color="#374151" />
                      <Text style={styles.actionLabel}>리마인더</Text>
                    </TouchableOpacity>
                  )}
                  {!t.poll && (!!t.content || t.fileType === "image") && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => registerNotice(t)}>
                      <Ionicons name="megaphone-outline" size={22} color="#b45309" />
                      <Text style={styles.actionLabel}>공지 등록</Text>
                    </TouchableOpacity>
                  )}
                  {t.mine && !t.fileUrl && !t.poll && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => startEdit(t)}>
                      <Ionicons name="create-outline" size={22} color="#374151" />
                      <Text style={styles.actionLabel}>수정</Text>
                    </TouchableOpacity>
                  )}
                  {t.mine && (
                    <TouchableOpacity style={styles.actionItem} onPress={() => confirmDelete(t)}>
                      <Ionicons name="trash-outline" size={22} color="#ef4444" />
                      <Text style={[styles.actionLabel, { color: "#ef4444" }]}>삭제</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      {/* #5 멤버 추가 모달 */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView style={styles.addBg} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>멤버 추가</Text>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color="#9ca3af" />
              <TextInput style={styles.searchInput} placeholder="이름 검색" value={memberSearch} onChangeText={setMemberSearch} />
            </View>
            <FlatList
              style={{ maxHeight: 320 }}
              data={addCandidates}
              keyExtractor={(m) => m.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.addEmpty}>추가할 직원이 없습니다.</Text>}
              renderItem={({ item }) => {
                const on = selectedNew.has(item.id);
                return (
                  <TouchableOpacity
                    style={styles.addRow}
                    onPress={() =>
                      setSelectedNew((p) => {
                        const n = new Set(p);
                        n.has(item.id) ? n.delete(item.id) : n.add(item.id);
                        return n;
                      })
                    }
                  >
                    <View style={[styles.addCheck, on && styles.addCheckOn]}>
                      {on && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </View>
                    <Text style={styles.addName}>
                      {item.branch ? `[${item.branch}] ` : ""}{item.name}
                    </Text>
                  </TouchableOpacity>
                );
              }}
            />
            <View style={styles.addBtns}>
              <TouchableOpacity style={styles.addCancel} onPress={() => setAddOpen(false)}>
                <Text style={styles.addCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addConfirm, selectedNew.size === 0 && { opacity: 0.5 }]}
                disabled={selectedNew.size === 0 || addLoading}
                onPress={confirmAddMembers}
              >
                {addLoading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.addConfirmText}>{selectedNew.size > 0 ? `${selectedNew.size}명 추가` : "추가"}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 읽음/안읽은 멤버 확인 */}
      <Modal visible={readersOpen} transparent animationType="slide" onRequestClose={() => setReadersOpen(false)}>
        <View style={styles.addBg}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setReadersOpen(false)} />
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>읽음 확인</Text>
            {!readersData ? (
              <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
            ) : (
              <>
                <View style={styles.readersTabs}>
                  {(["unread", "read"] as const).map((t) => (
                    <TouchableOpacity key={t} style={[styles.readersTab, readersTab === t && styles.readersTabOn]} onPress={() => setReadersTab(t)}>
                      <Text style={[styles.readersTabText, readersTab === t && styles.readersTabTextOn]}>
                        {t === "unread" ? `안 읽음 ${readersData.unread.length}` : `읽음 ${readersData.read.length}`}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <FlatList
                  style={{ maxHeight: 360 }}
                  data={readersTab === "unread" ? readersData.unread : readersData.read}
                  keyExtractor={(r) => r.userId}
                  ListEmptyComponent={
                    <Text style={styles.addEmpty}>{readersTab === "unread" ? "모두 읽었습니다." : "아직 읽은 사람이 없습니다."}</Text>
                  }
                  renderItem={({ item: r }) => (
                    <View style={styles.memberRow}>
                      <Avatar name={r.name} size={32} uri={r.avatarUrl} />
                      <Text style={styles.memberName}>
                        {r.name}
                        {r.branch ? <Text style={styles.memberBranch}> · {r.branch}</Text> : null}
                      </Text>
                    </View>
                  )}
                />
              </>
            )}
            <TouchableOpacity style={styles.membersClose} onPress={() => setReadersOpen(false)}>
              <Text style={styles.addCancelText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 채팅방 메뉴 (이름 변경 / 멤버 관리) */}
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.menuBg} onPress={() => setMenuOpen(false)}>
          <View style={styles.menuCard}>
            {/* 이름 변경·멤버 관리는 그룹 전용 (DM 이름=상대방 이름이라 변경 대상 아님) */}
            {isGroup && (
            <TouchableOpacity style={styles.menuRow} onPress={() => { setMenuOpen(false); setRenameVal(chatTitle); setRenameOpen(true); }}>
              <Ionicons name="pencil-outline" size={18} color="#374151" />
              <Text style={styles.menuText}>채팅방 이름 변경</Text>
            </TouchableOpacity>
            )}
            {isGroup && (
            <TouchableOpacity style={styles.menuRow} onPress={() => { setMenuOpen(false); openMembers(); }}>
              <Ionicons name="people-outline" size={18} color="#374151" />
              <Text style={styles.menuText}>멤버 관리</Text>
            </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.menuRow} onPress={openLinks}>
              <Ionicons name="link-outline" size={18} color="#374151" />
              <Text style={styles.menuText}>링크 모아보기</Text>
            </TouchableOpacity>
            {/* 나가기 — DM은 목록에서 숨김(새 메시지 오면 다시 표시), 그룹은 채널 탈퇴.
                전체(isDefault) 채널은 나가도 목록에 남고 미읽음만 폭증하므로 항목 자체를 숨긴다 */}
            {route.params.isDefault !== true && (
            <TouchableOpacity style={styles.menuRow} onPress={() => {
              setMenuOpen(false);
              if (!myId) { Alert.alert("잠시만요", "정보를 불러오는 중입니다. 다시 시도해주세요."); return; }
              const verb = isGroup ? "나가기" : "숨기기";
              const msg = isGroup
                ? `"${chatTitle}"에서 나갈까요?`
                : `"${chatTitle}"님과의 대화를 목록에서 숨길까요?\n새 메시지가 오면 다시 표시됩니다.`;
              Alert.alert(verb, msg, [
                { text: "취소", style: "cancel" },
                {
                  text: verb, style: "destructive",
                  onPress: async () => {
                    try {
                      if (isGroup) await leaveChannel(channelId, myId || "");
                      else await hideChannel(channelId);
                      navigation.goBack();
                    } catch (e: any) {
                      Alert.alert("오류", e?.response?.data?.error || "처리 중 오류가 발생했습니다.");
                    }
                  },
                },
              ]);
            }}>
              <Ionicons name="exit-outline" size={18} color="#ef4444" />
              <Text style={[styles.menuText, { color: "#ef4444" }]}>{isGroup ? "채팅방 나가기" : "대화 숨기기"}</Text>
            </TouchableOpacity>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* 이름 변경 */}
      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.renameCard}>
            <Text style={styles.addTitle}>채팅방 이름 변경</Text>
            <TextInput style={styles.renameInput} value={renameVal} onChangeText={setRenameVal} placeholder="새 이름" autoFocus />
            <View style={styles.addBtns}>
              <TouchableOpacity style={styles.addCancel} onPress={() => setRenameOpen(false)}>
                <Text style={styles.addCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.addConfirm, !renameVal.trim() && { opacity: 0.5 }]} disabled={!renameVal.trim() || renaming} onPress={confirmRename}>
                {renaming ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.addConfirmText}>변경</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 멤버 관리 (목록 + 내보내기) — 바깥 탭으로도 닫힘 */}
      <Modal visible={membersOpen} transparent animationType="slide" onRequestClose={() => setMembersOpen(false)}>
        {/* 백드롭은 카드의 부모가 아니라 형제로 — Pressable이 부모면 목록 터치를 선점해 스크롤이 막힘(안드로이드) */}
        <View style={styles.addBg}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMembersOpen(false)} />
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>멤버 {memberList.length}명</Text>
            <FlatList
              style={{ maxHeight: 380 }}
              data={memberList}
              keyExtractor={(m) => m.userId}
              renderItem={({ item }) => (
                <View style={styles.memberRow}>
                  <Avatar name={item.name} size={32} />
                  <Text style={styles.memberName}>
                    {item.name}
                    {item.branch ? <Text style={styles.memberBranch}> · {item.branch}</Text> : null}
                    {item.userId === myId ? <Text style={styles.memberBranch}> (나)</Text> : null}
                  </Text>
                  {item.userId !== myId && (
                    <TouchableOpacity style={styles.kickBtn} onPress={() => kickMember(item)}>
                      <Text style={styles.kickText}>내보내기</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            />
            <TouchableOpacity style={styles.membersClose} onPress={() => setMembersOpen(false)}>
              <Text style={styles.addCancelText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 메시지 전달 — 채널 선택 */}
      <Modal visible={!!forwardFor} transparent animationType="slide" onRequestClose={() => setForwardFor(null)}>
        <KeyboardAvoidingView style={styles.addBg} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>메시지 전달</Text>
            <Text style={styles.forwardPreview} numberOfLines={2}>
              {forwardFor?.content ||
                (forwardFor?.albumUrls?.length ? `🖼️ 사진 ${forwardFor.albumUrls.length}장` : forwardFor?.fileType === "image" ? "🖼️ 사진" : forwardFor?.fileType === "video" ? "🎬 동영상" : `📎 ${forwardFor?.fileName || "파일"}`)}
            </Text>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color="#9ca3af" />
              <TextInput style={styles.searchInput} placeholder="채팅방 또는 구성원 검색" value={forwardSearch} onChangeText={setForwardSearch} />
            </View>
            {!forwardChannels ? (
              <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
            ) : (
              (() => {
                const q = forwardSearch.trim().toLowerCase();
                const chs = forwardChannels.filter((c) => !q || c.name.toLowerCase().includes(q));
                const mems = q ? forwardMembers.filter((m) => m.name.toLowerCase().includes(q)) : [];
                const rows = [
                  ...chs.map((c) => ({ key: `ch-${c.id}`, kind: "channel" as const, id: c.id, name: c.name, sub: null as string | null, dm: c.type === "DM" })),
                  ...mems.map((m) => ({ key: `mem-${m.id}`, kind: "member" as const, id: m.id, name: m.name, sub: m.branch ?? null, dm: true })),
                ];
                return (
                  <FlatList
                    style={{ maxHeight: 340 }}
                    data={rows}
                    keyExtractor={(r) => r.key}
                    keyboardShouldPersistTaps="handled"
                    ListEmptyComponent={<Text style={styles.addEmpty}>검색 결과가 없습니다.</Text>}
                    renderItem={({ item: r }) => (
                      <TouchableOpacity style={styles.forwardRow} onPress={() => (r.kind === "channel" ? doForward(r.id) : doForwardToMember(r.id))}>
                        <Ionicons name={r.dm ? "person" : "people"} size={17} color="#4f46e5" />
                        <Text style={styles.forwardName} numberOfLines={1}>
                          {r.name}
                          {r.sub ? <Text style={styles.memberBranch}> · {r.sub}</Text> : null}
                        </Text>
                        {r.kind === "member" ? <Text style={styles.forwardDmTag}>1:1 전달</Text> : null}
                      </TouchableOpacity>
                    )}
                  />
                );
              })()
            )}
            <TouchableOpacity style={styles.membersClose} onPress={() => setForwardFor(null)}>
              <Text style={styles.addCancelText}>취소</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 예약 전송 (전송 버튼 길게 누르기) */}
      <Modal visible={scheduleOpen} transparent animationType="slide" onRequestClose={() => setScheduleOpen(false)}>
        <KeyboardAvoidingView style={styles.addBg} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>⏰ 예약 전송</Text>
            <Text style={styles.forwardPreview} numberOfLines={3}>{text.trim() || "입력창에 메시지를 먼저 작성해주세요."}</Text>
            <Text style={styles.reqLabel2}>발송 시각</Text>
            <View style={styles.scheduleRow}>
              <View style={{ flex: 1 }}>
                <DatePicker value={scheduleDate} onChange={setScheduleDate} placeholder="날짜" />
              </View>
              <TextInput
                style={styles.timeInput}
                value={scheduleTime}
                onChangeText={setScheduleTime}
                placeholder="09:00"
                keyboardType="numbers-and-punctuation"
                maxLength={5}
              />
            </View>
            {(scheduledList?.length ?? 0) > 0 && (
              <>
                <Text style={styles.reqLabel2}>대기 중 예약</Text>
                <FlatList
                  style={{ maxHeight: 140 }}
                  data={scheduledList || []}
                  keyExtractor={(s) => s.id}
                  renderItem={({ item: s }) => (
                    <View style={styles.scheduledRow}>
                      <Text style={styles.scheduledAt}>
                        {new Date(s.sendAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </Text>
                      <Text style={styles.scheduledText} numberOfLines={1}>{s.content}</Text>
                      <TouchableOpacity onPress={() => removeScheduled(s.id)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="close-circle" size={18} color="#9ca3af" />
                      </TouchableOpacity>
                    </View>
                  )}
                />
              </>
            )}
            <View style={styles.addBtns}>
              <TouchableOpacity style={styles.addCancel} onPress={() => setScheduleOpen(false)}>
                <Text style={styles.addCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.addConfirm, !text.trim() && { opacity: 0.5 }]} disabled={!text.trim()} onPress={submitSchedule}>
                <Text style={styles.addConfirmText}>예약하기</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 링크 모아보기 */}
      <Modal visible={linksOpen} transparent animationType="slide" onRequestClose={() => setLinksOpen(false)}>
        <View style={styles.addBg}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setLinksOpen(false)} />
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>공유된 링크</Text>
            {!linksData ? (
              <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
            ) : (
              <FlatList
                style={{ maxHeight: 400 }}
                data={linksData}
                keyExtractor={(_, i) => String(i)}
                ListEmptyComponent={<Text style={styles.addEmpty}>공유된 링크가 없습니다.</Text>}
                renderItem={({ item: l }) => (
                  <TouchableOpacity style={styles.linkRow} onPress={() => Linking.openURL(l.url)}>
                    <Ionicons name="link-outline" size={16} color="#4f46e5" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.linkUrl} numberOfLines={1}>{l.url}</Text>
                      <Text style={styles.linkMeta}>{l.userName} · {new Date(l.createdAt).toLocaleDateString("ko-KR")}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity style={styles.membersClose} onPress={() => setLinksOpen(false)}>
              <Text style={styles.addCancelText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 투표 만들기 */}
      <Modal visible={pollOpen} transparent animationType="slide" onRequestClose={() => setPollOpen(false)}>
        <KeyboardAvoidingView style={styles.addBg} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.addCard}>
            <Text style={styles.addTitle}>투표 만들기</Text>
            <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
              <TextInput style={styles.pollInput} placeholder="투표 질문 (예: 회식 날짜는?)" value={pollQ} onChangeText={setPollQ} />
              {pollOpts.map((o, i) => (
                <View key={i} style={styles.pollOptInputRow}>
                  <TextInput
                    style={[styles.pollInput, { flex: 1, marginBottom: 0 }]}
                    placeholder={`선택지 ${i + 1}`}
                    value={o}
                    onChangeText={(v) => setPollOpts((prev) => prev.map((x, idx) => (idx === i ? v : x)))}
                  />
                  {pollOpts.length > 2 && (
                    <TouchableOpacity onPress={() => setPollOpts((prev) => prev.filter((_, idx) => idx !== i))}>
                      <Ionicons name="close-circle" size={20} color="#9ca3af" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {pollOpts.length < 10 && (
                <TouchableOpacity style={styles.pollAddOpt} onPress={() => setPollOpts((prev) => [...prev, ""])}>
                  <Ionicons name="add" size={16} color="#4f46e5" />
                  <Text style={styles.pollAddOptText}>선택지 추가</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.pollMultiRow} onPress={() => setPollMulti((v) => !v)}>
                <View style={[styles.addCheck, pollMulti && styles.addCheckOn]}>
                  {pollMulti && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <Text style={styles.pollMultiLabel}>복수 선택 허용</Text>
              </TouchableOpacity>
              <Text style={styles.pollCloseLabel}>종료 시간 (선택) — 지나면 자동 마감 + 채팅 알림</Text>
              <View style={styles.pollCloseRow}>
                {[{ l: "없음", h: null }, { l: "1시간", h: 1 }, { l: "3시간", h: 3 }, { l: "6시간", h: 6 }, { l: "24시간", h: 24 }, { l: "3일", h: 72 }].map((c) => (
                  <TouchableOpacity key={c.l} style={[styles.pollCloseChip, pollCloseHours === c.h && styles.pollCloseChipOn]} onPress={() => setPollCloseHours(c.h)}>
                    <Text style={[styles.pollCloseChipText, pollCloseHours === c.h && { color: "#fff" }]}>{c.l}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>
            <View style={styles.addBtns}>
              <TouchableOpacity style={styles.addCancel} onPress={() => setPollOpen(false)}>
                <Text style={styles.addCancelText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.addConfirm, (!pollQ.trim() || pollOpts.filter((o) => o.trim()).length < 2) && { opacity: 0.5 }]}
                disabled={pollSubmitting || !pollQ.trim() || pollOpts.filter((o) => o.trim()).length < 2}
                onPress={submitPoll}
              >
                {pollSubmitting ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.addConfirmText}>투표 올리기</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 인앱 사진 뷰어 — 채팅방의 모든 사진을 좌우 스와이프로 넘겨 본다 (카톡식) */}
      <Modal visible={!!imageViewer} transparent statusBarTranslucent animationType="fade" onRequestClose={() => setImageViewer(null)}>
        {imageViewer && (
          <View style={styles.viewerBg}>
            <FlatList
              data={imageViewer.urls}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              // 원본 이미지가 크므로 이웃 페이지만 미리 그린다(수십 MB 동시 다운로드 방지)
              windowSize={3}
              initialNumToRender={1}
              maxToRenderPerBatch={2}
              keyExtractor={(u, i) => `${i}-${u}`}
              initialScrollIndex={imageViewer.index}
              extraData={viewerIndex}
              getItemLayout={(_d, i) => ({ length: winW, offset: winW * i, index: i })}
              onScroll={(e) => setViewerIndex(Math.round(e.nativeEvent.contentOffset.x / winW))}
              scrollEventThrottle={16}
              scrollEnabled={!viewerZoomed}
              renderItem={({ item: u, index: pi }) => <ViewerPage uri={FILE_ORIGIN + u} width={winW} height={winH} active={pi === viewerIndex} onZoomChange={setViewerZoomed} />}
            />
            <View style={styles.viewerHead}>
              <Text style={styles.viewerCount}>{viewerIndex + 1} / {imageViewer.urls.length}</Text>
              <View style={{ flexDirection: "row", gap: 12 }}>
                {/* 사진 저장 — 묶음이면 한 장/전체 선택 */}
                <TouchableOpacity style={styles.viewerClose} onPress={onViewerDownload} disabled={downloading} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  {downloading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="download-outline" size={24} color="#fff" />}
                </TouchableOpacity>
                <TouchableOpacity style={styles.viewerClose} onPress={() => setImageViewer(null)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <Ionicons name="close" size={26} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  empty: { textAlign: "center", color: "#9ca3af", marginTop: 40 },
  listContent: { padding: 12 },
  row: { marginBottom: 12, maxWidth: "80%" },
  rowMine: { alignSelf: "flex-end", alignItems: "flex-end" },
  rowOther: { alignSelf: "flex-start", alignItems: "flex-start" },
  // 알림을 눌러 찾아온 메시지 — 잠깐 노란 배경으로 어느 것인지 알려준다
  rowHighlight: { backgroundColor: "#fef3c7", borderRadius: 12, paddingHorizontal: 6, paddingVertical: 4 },
  otherRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingLeft: 4 },
  otherBody: { flex: 1 },
  chatSearchBar: { flexDirection: "row", alignItems: "center", gap: 6, margin: 8, paddingHorizontal: 12, height: 40, borderRadius: 8, backgroundColor: "#f3f4f6" },
  chatSearchInput: { flex: 1, fontSize: 14, color: "#1f2937" },
  sender: { fontSize: 12, color: "#6b7280", marginBottom: 2, marginLeft: 4 },
  bubble: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 16 },
  bubbleImage: { padding: 4 },
  // 이모지 단독 메시지는 말풍선 배경 없이 (카톡식)
  bubbleEmoji: { backgroundColor: "transparent", paddingHorizontal: 0, paddingVertical: 2 },
  bubbleMine: { backgroundColor: "#4f46e5", borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: "#fff", borderBottomLeftRadius: 4 },
  msgText: { fontSize: 15, color: "#111827", lineHeight: 20 },
  msgTextMine: { color: "#fff" },
  mentionText: { color: "#4f46e5", fontWeight: "700" },
  mentionTextMine: { color: "#c7d2fe", fontWeight: "700" },
  mentionBox: {
    marginHorizontal: 8,
    marginBottom: 4,
    backgroundColor: "#fff",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    overflow: "hidden",
  },
  mentionRow: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  mentionName: { fontSize: 15, color: "#111827", fontWeight: "600" },
  mentionBranch: { fontSize: 12, color: "#9ca3af" },
  // 인용 답장 / 삭제 / 수정
  quoteBox: { borderLeftWidth: 3, borderLeftColor: "#a5b4fc", paddingLeft: 8, marginBottom: 6, opacity: 0.9 },
  quoteName: { fontSize: 12, fontWeight: "700", color: "#4f46e5" },
  quoteText: { fontSize: 13, color: "#6b7280" },
  deletedText: { fontStyle: "italic", color: "#9ca3af" },
  editedTag: { fontSize: 11, color: "#9ca3af" },
  editedTagMine: { color: "#c7d2fe" },
  // 이모지 단독 메시지 크게
  jumboEmoji: { fontSize: 52, lineHeight: 64 },
  // 첨부와 함께 온 글(캡션) — 이미지 아래 여백
  captionText: { marginTop: 6, paddingHorizontal: 6, paddingBottom: 2 },
  // 글 아래에 오는 첨부 — 글과의 여백
  attachBelowText: { marginTop: 6 },
  // 긴 메시지 "전체 보기"
  expandBtn: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: "#e5e7eb", alignItems: "center" },
  expandBtnMine: { borderTopColor: "rgba(255,255,255,0.3)" },
  expandBtnText: { fontSize: 12, fontWeight: "600", color: "#6366f1" },
  expandBtnTextMine: { color: "rgba(255,255,255,0.95)" },
  // 롱프레스 액션시트
  actionSheet: { backgroundColor: "transparent", alignItems: "center" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", backgroundColor: "#fff", borderRadius: 14, marginTop: 10, paddingHorizontal: 8, paddingVertical: 10, gap: 4, shadowColor: "#000", shadowOpacity: 0.1, shadowRadius: 8, elevation: 4, maxWidth: 340 },
  actionItem: { alignItems: "center", paddingHorizontal: 12, paddingVertical: 4, gap: 2 },
  actionLabel: { fontSize: 12, color: "#374151" },
  // 답장/수정 미리보기 바
  replyBar: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 8, marginBottom: 4, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#eef2ff", borderRadius: 10 },
  replyBarTitle: { fontSize: 12, fontWeight: "700", color: "#4f46e5" },
  replyBarText: { fontSize: 13, color: "#6b7280", marginTop: 1 },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  reactionChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reactionChipMine: { backgroundColor: "#eef2ff", borderColor: "#c7d2fe" },
  reactionText: { fontSize: 13, color: "#374151" },
  time: { fontSize: 11, color: "#9ca3af", marginTop: 3, marginHorizontal: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  unreadCount: { fontSize: 11, color: "#facc15", fontWeight: "700", marginTop: 3 },
  typingBar: { paddingHorizontal: 16, paddingBottom: 4 },
  typingText: { fontSize: 12, color: "#9ca3af", fontStyle: "italic" },
  albumGrid: { flexDirection: "row", flexWrap: "wrap", gap: 3, width: 226 },
  albumCell: { width: 110, height: 110, borderRadius: 8, backgroundColor: "#e5e7eb" },
  albumMore: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 8, alignItems: "center", justifyContent: "center" },
  albumMoreText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  // 업로드 진행률 바
  uploadBar: { marginHorizontal: 12, marginBottom: 6 },
  uploadTrack: { height: 6, borderRadius: 3, backgroundColor: "#e5e7eb", overflow: "hidden" },
  uploadFill: { height: "100%", backgroundColor: "#4f46e5", borderRadius: 3 },
  uploadText: { fontSize: 12, color: "#6b7280", marginTop: 4, textAlign: "center" },
  clipBarWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginHorizontal: 8, marginBottom: 4 },
  clipBar: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#eef2ff", borderWidth: 1, borderColor: "#c7d2fe", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  clipBarText: { fontSize: 13, color: "#4f46e5", fontWeight: "600" },
  // 채널 고정 공지
  noticeBar: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginHorizontal: 8, marginTop: 6, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: "#fffbeb", borderWidth: 1, borderColor: "#fde68a", borderRadius: 10 },
  noticePin: { fontSize: 13 },
  noticeText: { fontSize: 13, color: "#92400e", lineHeight: 18 },
  noticeBy: { fontSize: 11, color: "#d97706" },
  noticeImage: { width: 180, height: 120, borderRadius: 8, marginTop: 6, backgroundColor: "#fde68a" },
  noticeBarImportant: { backgroundColor: "#fef2f2", borderColor: "#fecaca" },
  noticeImpBadge: { backgroundColor: "#ef4444", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, marginTop: 1 },
  noticeImpBadgeText: { color: "#fff", fontSize: 10, fontWeight: "700" },
  noticeMetaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 3 },
  noticeUnreadBtn: { fontSize: 11, color: "#dc2626", fontWeight: "700", textDecorationLine: "underline" },
  // 투표 카드
  pollCard: { minWidth: 220 },
  pollQ: { fontSize: 15, fontWeight: "700", color: "#111827", marginBottom: 8 },
  pollOpt: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, marginBottom: 6, overflow: "hidden", backgroundColor: "#fff" },
  pollOptOn: { borderColor: "#6366f1" },
  pollFill: { position: "absolute", left: 0, top: 0, bottom: 0, backgroundColor: "#e5e7eb" },
  pollOptRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  pollOptText: { fontSize: 13, color: "#111827", flex: 1 },
  pollCnt: { fontSize: 13, color: "#4f46e5", fontWeight: "700" },
  pollFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  pollMeta: { fontSize: 11, color: "#6b7280" },
  pollClose: { fontSize: 12, color: "#4f46e5", textDecorationLine: "underline" },
  // 메시지 전달
  forwardPreview: { fontSize: 13, color: "#6b7280", backgroundColor: "#f9fafb", borderRadius: 8, padding: 10, marginBottom: 8 },
  forwardRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  forwardName: { fontSize: 15, color: "#111827", flex: 1 },
  forwardDmTag: { fontSize: 11, color: "#6366f1", fontWeight: "600" },
  // 예약 전송
  reqLabel2: { fontSize: 13, fontWeight: "600", color: "#6b7280", marginTop: 8, marginBottom: 6 },
  scheduleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  timeInput: { width: 88, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, textAlign: "center", color: "#111827" },
  scheduledRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  scheduledAt: { fontSize: 12, color: "#4f46e5", fontWeight: "700" },
  scheduledText: { flex: 1, fontSize: 13, color: "#374151" },
  // 링크 모아보기
  linkRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  linkUrl: { fontSize: 13, color: "#4f46e5", textDecorationLine: "underline" },
  linkMeta: { fontSize: 11, color: "#9ca3af", marginTop: 2 },
  // 투표 만들기
  pollInput: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, marginBottom: 8, color: "#111827" },
  pollOptInputRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  pollAddOpt: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6 },
  pollAddOptText: { fontSize: 13, color: "#4f46e5", fontWeight: "600" },
  pollMultiRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10 },
  pollMultiLabel: { fontSize: 14, color: "#374151" },
  pollCloseLabel: { fontSize: 12, color: "#6b7280", marginTop: 2, marginBottom: 6 },
  pollCloseRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 4 },
  pollCloseChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: "#d1d5db", backgroundColor: "#fff" },
  pollCloseChipOn: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  pollCloseChipText: { fontSize: 12, color: "#374151" },
  systemRow: { alignItems: "center", marginVertical: 6 },
  systemText: { fontSize: 11, color: "#9ca3af", backgroundColor: "#eceef1", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, overflow: "hidden" },
  viewerBg: { flex: 1, backgroundColor: "#000" },
  viewerHead: { position: "absolute", top: 48, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 18 },
  viewerCount: { color: "#fff", fontSize: 14, fontWeight: "600", backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden" },
  viewerClose: { backgroundColor: "rgba(0,0,0,0.45)", borderRadius: 999, padding: 4 },
  dateDividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 10, paddingHorizontal: 4 },
  dateDividerLine: { flex: 1, height: 1, backgroundColor: "#e5e7eb" },
  dateDividerText: { fontSize: 11, color: "#9ca3af", backgroundColor: "#eceef1", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, overflow: "hidden" },
  menuBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.25)", justifyContent: "flex-start", alignItems: "flex-end", paddingTop: 52, paddingRight: 12 },
  menuCard: { backgroundColor: "#fff", borderRadius: 12, paddingVertical: 6, minWidth: 180, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 12 },
  menuText: { fontSize: 15, color: "#374151" },
  renameCard: { backgroundColor: "#fff", borderRadius: 14, padding: 18, marginHorizontal: 24, alignSelf: "stretch" },
  renameInput: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, marginBottom: 4, color: "#111827" },
  memberRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  readersTabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#e5e7eb", marginBottom: 6 },
  readersTab: { flex: 1, alignItems: "center", paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: "transparent" },
  readersTabOn: { borderBottomColor: "#4f46e5" },
  readersTabText: { fontSize: 14, color: "#9ca3af", fontWeight: "600" },
  readersTabTextOn: { color: "#4f46e5" },
  memberName: { flex: 1, fontSize: 15, color: "#111827" },
  memberBranch: { fontSize: 12, color: "#9ca3af" },
  kickBtn: { borderWidth: 1, borderColor: "#fecaca", backgroundColor: "#fef2f2", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  // 주의: addCancel은 flex:1이라 세로(column) 배치에선 높이가 0으로 붕괴함 — 멤버 모달 닫기는 전용 스타일 사용
  membersClose: { marginTop: 12, height: 46, borderRadius: 10, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  kickText: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  linkInText: { color: "#2563eb", textDecorationLine: "underline" },
  linkInTextMine: { color: "#c7d2fe", textDecorationLine: "underline" },
  linkCard: { flexDirection: "row", marginTop: 6, borderRadius: 12, overflow: "hidden", borderWidth: 1, maxWidth: 280 },
  linkCardMine: { backgroundColor: "#6366f1", borderColor: "#818cf8", alignSelf: "flex-end" },
  linkCardOther: { backgroundColor: "#f9fafb", borderColor: "#e5e7eb", alignSelf: "flex-start" },
  linkImage: { width: 72, height: 72 },
  linkBody: { flex: 1, padding: 8, justifyContent: "center" },
  linkSite: { fontSize: 10, color: "#9ca3af", marginBottom: 1 },
  linkSiteMine: { color: "#c7d2fe" },
  linkTitle: { fontSize: 13, fontWeight: "700", color: "#1f2937" },
  linkTitleMine: { color: "#fff" },
  linkDesc: { fontSize: 11, color: "#6b7280", marginTop: 1 },
  linkDescMine: { color: "#e0e7ff" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    padding: 8,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
    backgroundColor: "#fff",
  },
  // 대기 첨부 미리보기 바
  pendingBar: { borderTopWidth: 1, borderTopColor: "#e5e7eb", backgroundColor: "#fff", paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 },
  pendingItem: { marginRight: 8, marginBottom: 4, position: "relative" },
  pendingThumb: { width: 60, height: 60, borderRadius: 8, backgroundColor: "#f3f4f6" },
  pendingFileBox: { width: 84, height: 60, borderRadius: 8, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  pendingFileName: { fontSize: 9, color: "#374151", textAlign: "center", marginTop: 2 },
  pendingRemove: { position: "absolute", top: -5, right: -5, width: 18, height: 18, borderRadius: 9, backgroundColor: "#374151", alignItems: "center", justifyContent: "center" },
  attachBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    maxHeight: 100,
    minHeight: 40,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#f3f4f6",
    borderRadius: 20,
    fontSize: 15,
    color: "#111827", // 시스템 다크모드 글자 반전 방지
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#4f46e5",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { backgroundColor: "#c7d2fe" },
  // 음성 메시지 (마이크 버튼 + 녹음 중 바)
  micBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "#eef2ff", borderWidth: 1, borderColor: "#c7d2fe",
    alignItems: "center", justifyContent: "center", marginLeft: 8,
  },
  recBar: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "#fef2f2", borderWidth: 1, borderColor: "#fecaca",
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 10,
  },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#ef4444" },
  recText: { fontSize: 14, color: "#dc2626", fontWeight: "600" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.3)", justifyContent: "center", alignItems: "center" },
  emojiBar: {
    flexDirection: "row",
    gap: 10,
    backgroundColor: "#fff",
    borderRadius: 30,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  emojiBig: { fontSize: 30 },
  emojiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    backgroundColor: "#fff",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    maxWidth: 320,
    justifyContent: "center",
  },
  emojiGridCell: { width: 48, alignItems: "center", paddingVertical: 6 },
  emojiMoreBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: "#f3f4f6",
    alignItems: "center", justifyContent: "center", alignSelf: "center",
  },
  addBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
  addCard: { backgroundColor: "#fff", borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 18, paddingBottom: 28 },
  addTitle: { fontSize: 17, fontWeight: "bold", color: "#111827", marginBottom: 12 },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, height: 40, borderRadius: 8, backgroundColor: "#f3f4f6", marginBottom: 8 },
  searchInput: { flex: 1, fontSize: 14, color: "#111827" },
  addEmpty: { textAlign: "center", color: "#9ca3af", paddingVertical: 24 },
  addRow: { flexDirection: "row", alignItems: "center", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: "#f3f4f6" },
  addCheck: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "#d1d5db", alignItems: "center", justifyContent: "center", marginRight: 12 },
  addCheckOn: { backgroundColor: "#4f46e5", borderColor: "#4f46e5" },
  addName: { fontSize: 15, color: "#111827" },
  addBtns: { flexDirection: "row", gap: 8, marginTop: 14 },
  addCancel: { flex: 1, height: 46, borderRadius: 10, backgroundColor: "#f3f4f6", alignItems: "center", justifyContent: "center" },
  addCancelText: { fontSize: 15, color: "#374151", fontWeight: "600" },
  addConfirm: { flex: 1, height: 46, borderRadius: 10, backgroundColor: "#4f46e5", alignItems: "center", justifyContent: "center" },
  addConfirmText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
