import React, { useCallback, useEffect, useState } from "react";
import { LEAVE_LABELS, syncLeaveLabels } from "../services/leaveLabels";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Image,
  Linking,
  Pressable,
  AppState,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation, useIsFocused } from "@react-navigation/native";
import { DashboardStats, Announcement } from "@shiftee/api";
import * as api from "../services/api";
import * as storage from "../services/storage";
import { renderAnnouncementBody } from "./work/WorkAnnouncementsScreen";
import { getTodayStatus, TodayStatus } from "../services/attendance";
import { canApproveNow } from "../services/approvals";
import { loadInboxPreview } from "./approvals/ApprovalsScreen";
import { refreshBadges } from "../services/badges";
import { fileUri, useUploadsTicketVersion } from "../services/work";
import { ImageViewerModal } from "../components/ImageViewer";
import BranchNowCard from "../components/BranchNowCard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getMissedOutDays } from "../services/attendance";

// 휴가 유형 라벨 (대기 결재 내역 표시용)
const TYPE_LABEL: Record<string, string> = LEAVE_LABELS;   // 공용 객체 — syncLeaveLabels 가 본부 유형 이름을 채운다(#216-1)

type ModalKind = "contract" | "approval" | "announcement";

export default function HomeScreen() {
  useUploadsTicketVersion(); // 첨부·계약서 티켓이 첫 렌더보다 늦게 와도 다시 그려지게(2026-10-06)
  const navigation = useNavigation<any>();
  const [userName, setUserName] = useState("");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [todayStatus, setTodayStatus] = useState<TodayStatus | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [modal, setModal] = useState<ModalKind | null>(null);
  const [activeAnn, setActiveAnn] = useState<Announcement | null>(null);
  // 공지 사진은 앱 안에서 확대해 본다(예전엔 브라우저로 나가서 다운로드해야 했다)
  const [photoViewer, setPhotoViewer] = useState<{ urls: string[]; index: number } | null>(null);
  const [approvalLines, setApprovalLines] = useState<string[] | null>(null); // null=로딩중
  // 결재할 수 있는 사람(원장·본부·원장대행)은 「대기 결재」 = **내가 결재할 건수**, 누르면 결재 화면(2026-10-07 #14·#17)
  // null 이면 결재자가 아니다 — 종전처럼 내 신청 중 건수를 보여 준다
  const [approver, setApprover] = useState(false);
  // 원장 · 관리자 = 홈 「현재 근무 상황」(원장대행 직원은 결재자여도 지점 현황 권한이 없다 — 역할로만)
  const [staff, setStaff] = useState<"" | "ADMIN" | "MANAGER">("");
  const [reloadKey, setReloadKey] = useState(0);
  const [inbox, setInbox] = useState<number | null>(null);   // 결재할 건수(모르면 null → 「…」)
  // 홈 맨 위 「승인 대기」 목록(2026-10-23 앱 7 · 시안 S2-1) — 승인 화면 카드와 같은 한 줄 요약
  const [inboxItems, setInboxItems] = useState<{ key: string; who: string; group: string; summary: string; when: string }[]>([]);
  const [waiting, setWaiting] = useState(0);   // 본부 — 원장 승인 전(아직 원장 차례) 건수, 목록 맨 아래 한 줄(S6 ③)
  const [myBranch, setMyBranch] = useState("");
  // 퇴근 누락 안내 창(2026-10-29 이예지) — 7일 안에 퇴근 기록이 없는 날이 있으면 앱을 열 때 띄운다.
  // 「나중에」 = 그날은 다시 안 띄움, 요청을 넣을 때까지 다음 날 또 띄운다. 큐브티 기록(10/26~)만
  const [missedDays, setMissedDays] = useState<string[]>([]);
  const checkMissed = useCallback(() => {
    const t = new Date();
    const today = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
    Promise.all([getMissedOutDays().catch(() => [] as string[]), AsyncStorage.getItem("missedOutLater").catch(() => null)])
      .then(([days, later]) => setMissedDays(later === today ? [] : days.filter((d) => d >= "2026-10-26")))
      .catch(() => {});
  }, []);
  useFocusEffect(checkMissed);
  // 앱을 백그라운드에서 다시 열 때도(홈이 이미 열려 있으면 포커스 이벤트가 없다 — 검증 C1)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (st) => { if (st === "active") checkMissed(); });
    return () => sub.remove();
  }, [checkMissed]);
  const homeFocused = useIsFocused();   // 다른 탭에 있을 때는 띄우지 않는다(검증 P3)
  const missedLater = () => {
    const t = new Date();
    AsyncStorage.setItem("missedOutLater", `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`).catch(() => {});
    setMissedDays([]);
  };
  const missedFix = (d: string) => { setMissedDays([]); navigation.navigate("Attendance", { missedOutDate: d }); };
  const isYesterday = (d: string) => { const y = new Date(); y.setDate(y.getDate() - 1); return d === `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`; };
  const mdOf = (d: string) => { const [, m, dd] = d.split("-").map(Number); const w = ["일", "월", "화", "수", "목", "금", "토"][new Date(Number(d.slice(0, 4)), m - 1, dd).getDay()]; return `${m}/${dd}(${w})`; };

  const load = useCallback(async () => {
    try {
      const [user, s, anns, ts] = await Promise.all([
        storage.getUser(),
        api.getDashboardStats(),
        api.getAnnouncements(),
        getTodayStatus().catch(() => null),
      ]);
      setUserName(user?.name ?? "");
      setMyBranch(user?.branch ?? "");
      setStats(s);
      setAnnouncements(anns.slice(0, 5));
      setTodayStatus(ts);
    } catch (error) {
      console.error("❌ Failed to load home:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    syncLeaveLabels().catch(() => {});   // 본부가 만든 휴가 유형 이름(#216-1) — 홈에 올 때 한 번(10분 캐시)
  }, [load]);

  // 결재 건수 — 홈 로딩(스피너)과 떼어 따로 부른다. 결재 화면에서 처리하고 돌아오면 줄어 있어야 해서
  // 홈에 들어올 때마다 다시 센다. 못 세면 이전 값을 그대로 둔다(0건으로 속이지 않게)
  const refreshInbox = useCallback(() => {
    canApproveNow()
      .then(async (ok) => {
        if (ok === null) return;            // 판정 실패 — 이전 상태 유지
        setApprover(ok);
        if (!ok) return;
        const u = await storage.getUser().catch(() => null);
        const p = await loadInboxPreview(u?.role === "ADMIN");
        if (p) { setInbox(p.count); setInboxItems(p.items); setWaiting(p.waiting); }
        refreshBadges().catch(() => {});
      })
      .catch(() => {});
  }, []);
  // 원장·본부는 저장된 역할로 바로 결재자 모드 — 결재함 응답을 기다리는 동안 「내 신청」 카드가 잠깐 보이지 않게
  useEffect(() => {
    storage.getUser().then((u) => { if (u?.role === "ADMIN" || u?.role === "MANAGER") { setApprover(true); setStaff(u.role); } }).catch(() => {});
  }, []);
  useFocusEffect(refreshInbox);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
    refreshInbox();
    setReloadKey((k) => k + 1);
  }, [load, refreshInbox]);

  // 대기 결재(내 신청 중) 월·유형별 집계
  const openApproval = useCallback(async () => {
    setModal("approval");
    setApprovalLines(null);
    try {
      const [leave, sched] = await Promise.all([
        api.getLeaveRequests().catch(() => []),
        api.getScheduleRequests("PENDING").catch(() => []),
      ]);
      const counts = new Map<string, number>();
      (leave as any[])
        .filter((r) => r.status === "PENDING")
        .forEach((r) => {
          const m = new Date(r.startDate).getMonth() + 1;
          const key = `${m}월 ${TYPE_LABEL[r.type] || r.type} 신청`;
          counts.set(key, (counts.get(key) || 0) + 1);
        });
      // 내가 올린 휴가 취소 결재(진행 중) — 휴가 목록에 실려 오는 pendingCancel 로 센다(9/11)
      (leave as any[])
        .filter((r) => r.pendingCancel)
        .forEach((r) => {
          const m = new Date(r.startDate).getMonth() + 1;
          const key = `${m}월 휴가 취소 요청`;
          counts.set(key, (counts.get(key) || 0) + 1);
        });
      (sched as any[]).forEach((s) => {
        const m = new Date(s.startDate).getMonth() + 1;
        const key = `${m}월 근무 변경 요청`;
        counts.set(key, (counts.get(key) || 0) + 1);
      });
      setApprovalLines([...counts.entries()].map(([k, v]) => `${k} ${v}건`));
    } catch {
      setApprovalLines([]);
    }
  }, []);

  const today = new Date();
  const dateStr = `${today.getMonth() + 1}월 ${today.getDate()}일 (${["일", "월", "화", "수", "목", "금", "토"][today.getDay()]})`;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  const pendingContracts = stats?.pendingContracts ?? 0;

  // 오늘 출퇴근 상태 카드 — 상태만(찍은 시각은 본부만, 2026-10-23 ■0-11)
  // 시각은 서버가 줄 때만 덧붙인다(timesHidden 이 false — 본부 · 「출퇴근 시각 보기」 켠 원장, 검증 B4)
  const inAt = todayStatus && (typeof todayStatus.timesHidden === "boolean" ? !todayStatus.timesHidden : true) && todayStatus.clockInAt ? new Date(todayStatus.clockInAt) : null;
  const inHHmm = inAt && !Number.isNaN(inAt.getTime()) ? `${String(inAt.getHours()).padStart(2, "0")}:${String(inAt.getMinutes()).padStart(2, "0")}` : "";
  const att = todayStatus?.clockedOut
    ? { value: "퇴근", label: inHHmm ? `내 근태 · ${inHHmm} 출근` : "내 근태", icon: "checkmark-done-outline" as const, color: "#64748b" }
    : todayStatus?.clockedIn
    ? { value: "근무 중", label: inHHmm ? `내 근태 · ${inHHmm} 출근` : "내 근태", icon: "walk-outline" as const, color: "#4f46e5" }
    : todayStatus?.pendingIn
    ? { value: "승인 대기", label: "출근 요청", icon: "hourglass-outline" as const, color: "#b45309" }
    : { value: "출근 전", label: "내 근태", icon: "time-outline" as const, color: "#64748b" };

  const leaveHidden = !!stats && ((stats as DashboardStats & { balanceHidden?: boolean }).balanceHidden === true || (stats.leaveRemaining as number | null) === null);
  const cards = [
    // 잔여 연차 칸을 누르면 휴가 신청으로 바로(2026-10-07 #14)
    // 잔여 숫자 숨김(2026-10-16 #219-1) — 서버가 leaveRemaining:null + balanceHidden 을 주면 「연차 정리 중」(공용 타입엔 아직 없는 칸)
    // 원장 · 본부는 아래 탭이 「승인」이라 본인 휴가는 더보기 「내 휴가」(10/23 앱 1). 아이콘은 인디고(초록 금지)
    { key: "leave", label: "잔여 연차", value: leaveHidden ? "연차 정리 중" : `${stats?.leaveRemaining ?? 0}일`, icon: "umbrella-outline", color: "#4f46e5",
      onPress: (() => (staff ? navigation.navigate("More", { screen: "MyLeave", initial: false }) : navigation.navigate("Leave"))) as undefined | (() => void) },
    { key: "contract", label: "서명 대기 계약", value: `${pendingContracts}건`, icon: "document-text-outline", color: "#b45309",
      onPress: () => (pendingContracts > 0 ? navigation.navigate("More", { screen: "Contracts", initial: false }) : setModal("contract")) },
    // 결재할 사람은 맨 위 「승인 대기」 목록이 대신한다 — 직원은 내 요청 중 결재 대기 건수
    ...(approver ? [] : [{ key: "approval", label: "결재 대기", value: `${stats?.pendingApprovals ?? 0}건`, icon: "hourglass-outline", color: "#b45309", onPress: openApproval }]),
    { key: "attendance", label: att.label, value: att.value, icon: att.icon, color: att.color, onPress: () => navigation.navigate("Attendance") },
  ].sort((a, b) => Number(b.key === "attendance") - Number(a.key === "attendance"));
  const openApprovals = () => (staff ? navigation.navigate("Approve") : navigation.navigate("More", { screen: "Approvals", initial: false }));
  // 원장 · 본부 「내 것」 띠 — 남은 연차 · 서명 대기(0건은 「없음」) · 내 근태(S6 ④)
  const mine = [
    { key: "leave", label: "남은 연차", value: leaveHidden ? "정리 중" : `${stats?.leaveRemaining ?? 0}일`, onPress: () => navigation.navigate("More", { screen: "MyLeave", initial: false }) },
    { key: "contract", label: "서명 대기", value: pendingContracts > 0 ? `${pendingContracts}건` : "없음", onPress: () => (pendingContracts > 0 ? navigation.navigate("More", { screen: "Contracts", initial: false }) : setModal("contract")) },
    { key: "attendance", label: "내 근태", value: att.value, onPress: () => navigation.navigate("Attendance") },
  ];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {/* 인사말은 직원 홈에만(원장 · 본부는 맨 위가 오늘 근태) */}
      {!staff && (
        <View style={styles.header}>
          <Text style={styles.greeting}>안녕하세요,</Text>
          <Text style={styles.name}>{userName || "사용자"}님</Text>
          <Text style={styles.date}>{dateStr}</Text>
        </View>
      )}

      {/* 홈 순서(2026-10-28 이예지 앱 홈 S6 ①) — ① 오늘 근태(원장은 지점 근태) → ② 결재 대기 → ③ 내 것 한 줄 → ④ 공지. 직원은 ③ 첫 칸이 내 근태 */}
      {!!staff && <View style={{ height: 14 }} />}
      {!!staff && <BranchNowCard reloadKey={reloadKey} title={staff === "ADMIN" ? "오늘 근태" : "지점 근태"} allBranches={staff === "ADMIN"} onOpenSchedule={() => navigation.navigate("Schedule", { view: "branch" })} />}

      {approver && (
        <View style={[styles.apprWrap, !staff && { marginTop: 14 }]}>
          <View style={styles.apprHead}>
            <Text style={styles.sectionTitle2}>결재 대기</Text>
            <View style={styles.cntPill}><Text style={styles.cntPillText}>{inbox === null ? "…" : inbox}</Text></View>
            <TouchableOpacity style={styles.allLink} onPress={openApprovals} accessibilityLabel="결재 전체 보기">
              <Text style={styles.allLinkText}>전체 ›</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.apprList}>
            {inbox === null && inboxItems.length === 0 ? (
              <Text style={styles.apprEmpty}>불러오는 중…</Text>
            ) : inbox === 0 && waiting === 0 ? (
              <Text style={styles.apprEmpty}>결재 대기가 없습니다.</Text>
            ) : inbox === 0 ? (
              <Text style={styles.apprEmpty}>본부 차례인 결재가 없습니다.</Text>
            ) : null}
            {/* 한 줄 = 이름 · 종류 · 날짜(같은 말이 두 줄에 겹치지 않게 — S6 ③). 본부 차례만, 원장 승인 전은 맨 아래 한 줄 */}
            {inboxItems.slice(0, 5).map((it, i) => (
              <TouchableOpacity key={it.key} style={[styles.apprRow, i > 0 && styles.apprLine]} onPress={openApprovals} activeOpacity={0.7}>
                <Text style={styles.apprWho} numberOfLines={1}>{it.who}</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.apprKind} numberOfLines={1}>{it.group}</Text>
                  <Text style={styles.apprSub} numberOfLines={2}>{it.when}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#4f46e5" />
              </TouchableOpacity>
            ))}
            {inboxItems.length > 5 && (
              <TouchableOpacity style={[styles.apprRow, styles.apprLine]} onPress={openApprovals} activeOpacity={0.7}>
                <Text style={styles.apprMore}>{inboxItems.length - 5}건 더 보기 ›</Text>
              </TouchableOpacity>
            )}
            {waiting > 0 && (
              <TouchableOpacity style={[styles.apprRow, (inboxItems.length > 0 || inbox === 0) && styles.apprLine, styles.apprWaitRow]} onPress={openApprovals} activeOpacity={0.7} accessibilityLabel={`원장 승인 전 ${waiting}건 보기`}>
                <Text style={styles.apprWaitText}>원장 승인 전 {waiting}건</Text>
                <Text style={styles.allLinkText}>보기 ›</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* 내 것 — 원장 · 본부는 띠 하나(남은 연차 · 서명 대기 · 내 근태, S6 ④), 직원은 내 근태가 첫 칸인 네 칸 */}
      {staff ? (
        <View style={styles.strip}>
          {mine.map((c, i) => (
            <TouchableOpacity key={c.key} style={[styles.stripCell, i > 0 && styles.stripLine]} activeOpacity={0.7} onPress={c.onPress} accessibilityLabel={`${c.label} ${c.value}`}>
              <Text style={styles.stripLab} numberOfLines={1}>{c.label}</Text>
              <Text style={styles.stripVal} numberOfLines={1}>{c.value}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <View style={styles.grid}>
          {cards.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={styles.card}
              activeOpacity={c.onPress ? 0.7 : 1}
              onPress={c.onPress}
              disabled={!c.onPress}
            >
              <View style={styles.cardTop}>
                <Ionicons name={c.icon as any} size={24} color={c.color} />
                {c.onPress && <Ionicons name="chevron-forward" size={16} color="#d1d5db" />}
              </View>
              <Text style={styles.cardValue}>{c.value}</Text>
              <Text style={styles.cardLabel}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* 공지 — 제목 한 줄 + 「작성자 · 10/22」, 고정은 작은 「고정」 알약(S6 ⑤) */}
      <View style={styles.section}>
        <View style={styles.apprHead}>
          <Text style={styles.sectionTitle2}>공지</Text>
          <TouchableOpacity style={styles.allLink} onPress={() => navigation.navigate("Work", { screen: "WorkAnnouncements", initial: false })} accessibilityLabel="공지 전체 보기">
            <Text style={styles.allLinkText}>전체 ›</Text>
          </TouchableOpacity>
        </View>
        {announcements.length === 0 ? (
          <View style={styles.apprList}><Text style={styles.apprEmpty}>등록된 공지가 없습니다.</Text></View>
        ) : (
          <View style={styles.apprList}>
            {announcements.map((a, i) => {
              const d = new Date(a.createdAt);
              return (
                <TouchableOpacity key={a.id} style={[styles.annRow, i > 0 && styles.apprLine]} activeOpacity={0.7} onPress={() => { setActiveAnn(a); setModal("announcement"); }}>
                  {a.pinned && <View style={styles.pinPill}><Text style={styles.pinPillText}>고정</Text></View>}
                  <Text style={styles.annTitle} numberOfLines={1}>{a.title}</Text>
                  <Text style={styles.annMeta} numberOfLines={1}>{a.authorName} · {d.getMonth() + 1}/{d.getDate()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      {/* 퇴근 누락 안내 창 — 날짜마다 「수정 요청」(그 날짜가 들어간 퇴근 처리 요청으로 바로) */}
      <Modal visible={missedDays.length > 0 && modal === null && homeFocused} transparent animationType="fade" onRequestClose={missedLater}>
        <View style={styles.backdrop}>
          <View style={styles.popup}>
            <Text style={styles.popupTitle}>{missedDays.length === 1 ? `${isYesterday(missedDays[0]) ? `어제(${Number(missedDays[0].slice(5, 7))}/${Number(missedDays[0].slice(8, 10))})` : mdOf(missedDays[0])} 퇴근 기록이 없어요` : `퇴근 기록이 없는 날이 ${missedDays.length}일 있어요`}</Text>
            <Text style={styles.popupBody}>퇴근 시각을 넣어 수정 요청해 주세요. {staff ? "본부가 확인합니다." : "지점 원장 → 본부 순서로 확인합니다."}</Text>
            <View style={{ marginTop: 12, gap: 8 }}>
              {missedDays.map((d) => (
                <TouchableOpacity key={d} style={styles.missBtn} onPress={() => missedFix(d)} activeOpacity={0.8} accessibilityLabel={`${mdOf(d)} 퇴근 수정 요청`}>
                  <Text style={styles.missBtnText}>{missedDays.length === 1 ? "수정 요청" : `${mdOf(d)} 수정 요청`}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity style={styles.missLater} onPress={missedLater} activeOpacity={0.7}>
                <Text style={styles.missLaterText}>나중에</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 팝업 */}
      <Modal visible={modal !== null} transparent animationType="fade" onRequestClose={() => setModal(null)}>
        {/* 배경은 카드의 '형제' Pressable 로 둔다 — 터치 가능한 컴포넌트가 스크롤의 부모면
            안드로이드에서 제스처를 선점해 긴 공지가 스크롤되지 않는다(iOS 는 협상해서 됨). */}
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setModal(null)} />
          <View style={styles.popup}>
            {modal === "contract" && (
              <>
                <Text style={styles.popupTitle}>서명 대기 계약</Text>
                {pendingContracts === 0 ? (
                  <Text style={styles.popupBody}>서명 대기 중인 계약이 없습니다.</Text>
                ) : (
                  <Text style={styles.popupBody}>
                    서명 대기 계약이 {pendingContracts}건 있습니다. 더보기 › 계약서에서 열어 보고 서명할 수 있습니다.
                  </Text>
                )}
              </>
            )}

            {modal === "approval" && (
              <>
                <Text style={styles.popupTitle}>결재 대기 내역</Text>
                {approvalLines === null ? (
                  <ActivityIndicator color="#2563eb" style={{ marginVertical: 16 }} />
                ) : approvalLines.length === 0 ? (
                  <Text style={styles.popupBody}>대기 중인 결재가 없습니다.</Text>
                ) : (
                  approvalLines.map((line, i) => (
                    <View key={i} style={styles.approvalRow}>
                      <Ionicons name="hourglass-outline" size={16} color="#b45309" />
                      <Text style={styles.approvalText}>{line}</Text>
                    </View>
                  ))
                )}
              </>
            )}

            {modal === "announcement" && activeAnn && (
              <>
                <View style={styles.annHeader}>
                  {activeAnn.pinned && <Ionicons name="pin" size={16} color="#ef4444" style={{ marginRight: 4 }} />}
                  <Text style={styles.popupTitle}>{activeAnn.title}</Text>
                </View>
                <Text style={styles.popupMeta}>
                  {activeAnn.authorName} · {new Date(activeAnn.createdAt).toLocaleDateString("ko-KR")}
                </Text>
                <ScrollView style={{ maxHeight: 400 }}>
                  <View>{renderAnnouncementBody(activeAnn.content, styles.popupBody, (urls, index) => setPhotoViewer({ urls, index }))}</View>
                  {(activeAnn.attachments?.length ?? 0) > 0 && (
                    <View style={styles.attList}>
                      {activeAnn.attachments.map((att, i) =>
                        att.type === "image" ? (
                          <TouchableOpacity
                            key={i}
                            onPress={() => {
                              const imgs = (activeAnn.attachments || []).filter((a) => a.type === "image");
                              setPhotoViewer({
                                urls: imgs.map((a) => fileUri(a.url)),
                                index: Math.max(0, imgs.findIndex((a) => a.url === att.url)),
                              });
                            }}
                          >
                            <Image source={{ uri: fileUri(att.url) }} style={styles.attImage} resizeMode="cover" />
                          </TouchableOpacity>
                        ) : (
                          <TouchableOpacity key={i} style={styles.attFile} onPress={() => Linking.openURL(fileUri(att.url))}>
                            <Ionicons name="attach" size={14} color="#2563eb" />
                            <Text style={styles.attFileName} numberOfLines={1}>{att.name}</Text>
                          </TouchableOpacity>
                        )
                      )}
                    </View>
                  )}
                </ScrollView>
              </>
            )}

            <TouchableOpacity style={styles.popupClose} onPress={() => setModal(null)}>
              <Text style={styles.popupCloseText}>닫기</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* 사진 뷰어는 이 팝업 '안'에 둔다 — 형제로 두면 iOS 에서 팝업 위로 안 올라온다 */}
        {photoViewer && (
          <ImageViewerModal urls={photoViewer.urls} index={photoViewer.index} onClose={() => setPhotoViewer(null)} />
        )}
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#f3f4f6" },
  header: { padding: 20, paddingTop: 24, backgroundColor: "#fff" },
  greeting: { fontSize: 14, color: "#6b7280" },
  name: { fontSize: 24, fontWeight: "bold", color: "#111827", marginTop: 2 },
  date: { fontSize: 13, color: "#9ca3af", marginTop: 6 },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    padding: 12,
    justifyContent: "space-between",
  },
  card: {
    width: "48%",
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  cardTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  cardValue: { fontSize: 22, fontWeight: "bold", color: "#111827", marginTop: 8 },
  cardLabel: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  section: { paddingHorizontal: 14, paddingBottom: 24, gap: 8 },
  sectionTitle: { fontSize: 16, fontWeight: "bold", color: "#111827", marginBottom: 10 },
  empty: { color: "#9ca3af", fontSize: 14, paddingVertical: 12 },
  annItem: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  annHeader: { flexDirection: "row", alignItems: "center" },
  annTitle: { fontSize: 14.5, fontWeight: "600", color: "#0f172a", flex: 1 },
  annContent: { fontSize: 13, color: "#4b5563", marginTop: 4 },
  annMeta: { fontSize: 12.5, color: "#64748b", flexShrink: 0, maxWidth: 120 },
  // 팝업
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
  popup: { backgroundColor: "#fff", borderRadius: 14, padding: 20 },
  popupTitle: { fontSize: 17, fontWeight: "700", color: "#111827", flexShrink: 1 },
  popupMeta: { fontSize: 12, color: "#9ca3af", marginTop: 6, marginBottom: 10 },
  popupBody: { fontSize: 14, color: "#374151", lineHeight: 21, marginTop: 12 },
  attList: { marginTop: 12, gap: 8 },
  attImage: { width: "100%", height: 180, borderRadius: 10, backgroundColor: "#f3f4f6" },
  attFile: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, alignSelf: "flex-start" },
  attFileName: { fontSize: 13, color: "#2563eb", textDecorationLine: "underline", maxWidth: 240 },
  approvalRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  approvalText: { fontSize: 14, color: "#374151" },
  popupClose: { marginTop: 20, backgroundColor: "#4f46e5", borderRadius: 10, minHeight: 46, justifyContent: "center", alignItems: "center" },
  // 승인 대기(원장 · 본부 홈 맨 위)
  apprWrap: { marginHorizontal: 14, marginBottom: 11, gap: 8 },
  apprHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  sectionTitle2: { fontSize: 16, fontWeight: "700", color: "#0f172a" },
  cntPill: { backgroundColor: "#fff1f2", borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },   // 결재 대기 건수 — 빨강(2026-10-29 이예지)
  cntPillText: { fontSize: 12.5, fontWeight: "700", color: "#be123c" },
  allLink: { marginLeft: "auto", minHeight: 44, justifyContent: "center", paddingLeft: 12 },
  allLinkText: { fontSize: 13.5, fontWeight: "700", color: "#4f46e5" },
  apprList: { backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#e2e8f0", overflow: "hidden" },
  apprRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 56 },
  apprKind: { fontSize: 14.5, fontWeight: "700", color: "#0f172a" },
  missBtn: { minHeight: 48, borderRadius: 12, backgroundColor: "#4f46e5", alignItems: "center", justifyContent: "center" },
  missBtnText: { fontSize: 15, fontWeight: "700", color: "#fff" },
  missLater: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  missLaterText: { fontSize: 14.5, fontWeight: "600", color: "#64748b" },
  apprMore: { flex: 1, fontSize: 13.5, color: "#475569", textAlign: "center" },
  apprWaitRow: { backgroundColor: "#fafbfd" },
  apprWaitText: { flex: 1, fontSize: 14, color: "#475569" },
  strip: { flexDirection: "row", marginHorizontal: 14, marginBottom: 11, backgroundColor: "#fff", borderRadius: 16, borderWidth: 1, borderColor: "#e2e8f0", overflow: "hidden" },
  stripCell: { flex: 1, alignItems: "center", paddingVertical: 12, paddingHorizontal: 6, minHeight: 62, justifyContent: "center" },
  stripLine: { borderLeftWidth: 1, borderLeftColor: "#f1f5f9" },
  stripLab: { fontSize: 12.5, fontWeight: "600", color: "#475569" },
  stripVal: { fontSize: 16, fontWeight: "800", color: "#0f172a", marginTop: 3 },
  annRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 12, minHeight: 50 },
  pinPill: { backgroundColor: "#eef2ff", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2 },
  pinPillText: { fontSize: 12.5, fontWeight: "700", color: "#4f46e5" },
  apprLine: { borderTopWidth: 1, borderTopColor: "#f1f5f9" },
  apprWho: { minWidth: 56, maxWidth: 96, flexShrink: 0, fontSize: 14.5, fontWeight: "700", color: "#0f172a" },
  apprSub: { fontSize: 13.5, color: "#475569", marginTop: 2 },
  apprEmpty: { fontSize: 13.5, color: "#64748b", padding: 14 },
  popupCloseText: { color: "#fff", fontSize: 15, fontWeight: "600" },
});
