"use client";
// 직원 대시보드 — 본부 시안 R17(2026-10-21 「디자인 통일」, 관리자 대시보드 R9 와 같은 세 박스): 나의 근태 · 결재함 · 공지사항.
//  · 나의 근태 4칸: 오늘 출근(시각 + 「퇴근 전 · 일정 13:00 ~ 22:00」) · 남은 연차(권한 「잔여 연차 숫자 보기」가 꺼지면 「연차 정리 중」)
//    · 이번 달 근무(시간) · 내 요청 대기(연인디고). 숫자는 색칠하지 않는다
//  · 결재함 = 서명할 내 계약서(「서명 ›」 → 내 계약서에서 비밀번호 한 칸 → 서명 전체 창) + 최근 14일 반려된 내 요청(「보기 ›」)
//  · 공지는 읽기만. 뺀 것: 「나의 업무」 바로가기 4개(레일과 겹침) · 0인 숫자 카드(대기 계약 0건 등 — 결재함이 대신) · 숫자 색칠
import { useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { PageHead, Box, Tiles, Tile } from "@/components/kit";
import { InboxBox, NoticeBox, useNotices, periodLabel, type InboxRow } from "@/components/dashboard/DashBoxes";
import { useLeaveCatalog } from "@/components/leave/useLeaveCatalog";
import { LEAVE_LABELS } from "@/lib/leave-catalog";

type MyStats = {
  leaveRemaining: number | null;
  balanceHidden?: boolean;   // 잔여 숫자 숨김(2026-10-16 #219-1) — 서버가 null 로 보낸다
  pendingContracts: number;
  pendingApprovals: number;  // 휴가 · 근무일정 · 휴가 취소
  pendingAttendance?: number; // 출퇴근 요청(기기 변경 제외)
  monthWorkHours: number | null;   // 직원 「본인 출퇴근 기록 열람」이 꺼지면 null
};
// 오늘 내 하루 — GET /api/schedule/day?scope=self 의 내 줄(출퇴근 열람이 꺼지면 시각 없이 일정 · 휴가만)
type MyDay = { status: string; scheduleType: string | null; startTime: string | null; endTime: string | null; clockIn: string | null; clockOut: string | null; leaveType: string | null };

const KST = 9 * 3600 * 1000;
const kstYmd = (t: number) => new Date(t + KST).toISOString().slice(0, 10);
const REJ_WORD: Record<string, string> = { LEAVE: "휴가 신청이", LEAVE_CANCEL: "휴가 취소가", SCHEDULE: "근무일정 요청이", ATTENDANCE: "출퇴근 요청이" };
// 요청 목록(lib/request-feed)의 기간 「YYYY-MM-DD」 · 「YYYY-MM-DD ~ YYYY-MM-DD」 → 「10/30」 · 「10/26 ~ 30」(다른 모양이면 그대로)
const feedPeriod = (p: string) => {
  const m = p.match(/^(\d{4}-\d{2}-\d{2})(?: ~ (\d{4}-\d{2}-\d{2}))?$/);
  return m ? periodLabel(m[1], m[2] ?? m[1]) : p;
};

export default function SharedDashboardPage() {
  const [name, setName] = useState("");
  const [stats, setStats] = useState<MyStats | null>(null);
  const [today, setToday] = useState<MyDay | null>(null);
  const [attHidden, setAttHidden] = useState(false);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const notices = useNotices();
  // 제목 옆 오늘 날짜 — 서버(UTC)가 그린 날짜와 브라우저 날짜가 KST 0~9시에 달라 화면이 어긋나지 않게, 받은 뒤에 그린다(R17 검증 6)
  const [todayLabel, setTodayLabel] = useState("");
  useLeaveCatalog();   // 본부가 만든 유형 이름을 LEAVE_LABELS 에 채운다

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const get = (u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const now = Date.now();
      setTodayLabel(format(new Date(now), "M월 d일 (EEE)", { locale: ko }));
      const ymd = kstYmd(now);
      const [me, st, day, contracts, rejected] = await Promise.all([
        get("/api/auth/me"),
        get("/api/me/dashboard-stats"),
        get(`/api/schedule/day?date=${ymd}&scope=self`),
        get("/api/contracts/my-approvals"),
        get(`/api/requests?who=mine&status=REJECTED&from=${kstYmd(now - 180 * 86400000)}`),   // 기간은 신청한 날 기준 — 미리 낸 휴가도 잡게 넉넉히, 반려한 때로 아래에서 거른다
      ]);
      const myId: string = me?.user?.id ?? "";
      setName(me?.user?.name ?? "");
      if (st) setStats(st);
      if (day) {
        setAttHidden(!!day.attendanceHidden);
        setToday(((day.employees || []) as (MyDay & { id: string })[]).find((e) => e.id === myId) ?? null);
      }
      const next: InboxRow[] = [];
      // 서명할 내 계약서 — 내 서명 차례가 온 것(남의 계약서 결재는 원장대행 「결재」에서)
      for (const c of (contracts?.contracts || []) as { id: string; title: string; userId?: string; externalName?: string | null; signDeadline?: string | null; createdAt: string }[]) {
        if (!myId || c.userId !== myId || c.externalName) continue;
        const due = c.signDeadline ? new Date(new Date(c.signDeadline).getTime() + KST).toISOString().slice(5, 10).replace("-", "/") : null;
        next.push({ key: `sign-${c.id}`, title: c.title, sub: `서명할 계약서${due ? ` · 기한 ${due}` : ""}`, href: `/contracts?sign=${encodeURIComponent(c.id)}`, action: "서명", at: new Date(c.createdAt).getTime() });
      }
      // 반려된 내 요청 — 반려한 때가 최근 14일인 것, 최근 3건(흐린 줄, 반려 사유 한 줄)
      const since = now - 14 * 86400000;
      const rej = ((rejected?.items || []) as { kind: string; id: string; title: string; period: string; createdAt: string; rejectedAt?: string; rejectReason: string | null }[])
        .map((it) => ({ ...it, at: new Date(it.rejectedAt ?? it.createdAt).getTime() }))
        .filter((it) => it.at >= since)
        .sort((x, y) => y.at - x.at).slice(0, 3);
      for (const it of rej) {
        // 휴가 취소는 제목이 「휴가 취소 — 연차」 — 앞말은 「휴가 취소가 반려됐어요」와 겹쳐 뺀다
        const what = `${feedPeriod(it.period)} ${it.kind === "LEAVE_CANCEL" ? it.title.replace(/^휴가 취소 — /, "") : it.title}`;
        next.push({ key: `rej-${it.kind}-${it.id}`, title: `${REJ_WORD[it.kind] ?? "요청이"} 반려됐어요 — ${what}`,
          sub: it.rejectReason ? `반려 사유: ${it.rejectReason}` : "반려 사유 보기", href: "/requests", action: "보기", muted: true, at: it.at });
      }
      setRows(next);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { Promise.resolve().then(load); }, [load]);   // 첫 읽기(렌더 중 setState 회피 — lint set-state-in-effect)

  // 오늘 출근 칸 — 값 = 출근 시각(없으면 —), 설명 = 퇴근 여부 · 오늘 일정(또는 휴가 · 휴무)
  const sched = today?.scheduleType === "WORK" && today.startTime && today.endTime ? `일정 ${today.startTime} ~ ${today.endTime}` : null;
  const leaveName = today?.leaveType ? LEAVE_LABELS[today.leaveType] ?? today.leaveType : null;
  const inValue = today?.status === "LEAVE" && !today.clockIn ? "휴가" : today?.clockIn ?? null;
  const inNote = [
    leaveName && today?.status === "LEAVE" ? leaveName : null,
    attHidden ? null : today?.clockOut ? `퇴근 ${today.clockOut}` : today?.clockIn ? "퇴근 전" : today && today.status !== "LEAVE" && sched ? "출근 전" : null,
    sched ?? (today && (today.scheduleType === "OFF" || today.scheduleType === "HOLIDAY") ? "오늘 휴무" : today && !today.scheduleType && today.status !== "LEAVE" ? "오늘 일정 없음" : null),
  ].filter(Boolean).join(" · ");
  const balanceHidden = !!stats && (stats.balanceHidden || stats.leaveRemaining === null);

  return (
    <div>
      <PageHead title={name ? `${name}님, 안녕하세요` : "안녕하세요"} note={todayLabel || undefined} />

      {/* 나의 근태 — 4칸(R17). 「휴가 신청 ›」 */}
      <Box icon={<Clock />} title="나의 근태" right={<a href="/leave" className="text-[#4f46e5] hover:underline">휴가 신청 ›</a>}>
        <Tiles cols={4}>
          <Tile label="오늘 출근" value={attHidden ? (inValue === "휴가" ? "휴가" : null) : inValue} note={inNote || undefined} />
          <Tile label="남은 연차" value={!stats ? null : balanceHidden ? "연차 정리 중" : stats.leaveRemaining} unit={balanceHidden ? undefined : "일"}
            onClick={() => { window.location.href = "/leave"; }} />
          <Tile label="이번 달 근무" value={stats?.monthWorkHours} unit="시간" note={stats && stats.monthWorkHours === null ? "출퇴근 기록 열람 꺼짐" : "출퇴근 기록 기준"} />
          <Tile label="내 요청 대기" value={stats ? stats.pendingApprovals + (stats.pendingAttendance ?? 0) : null} unit="건" note="휴가 · 근무일정 · 출퇴근 수정" hl onClick={() => { window.location.href = "/requests"; }} />
        </Tiles>
      </Box>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <InboxBox rows={rows.slice(0, 8)} loading={loading} count={rows.filter((r) => r.action === "서명").length}
          more={Math.max(0, rows.length - 8)} moreHref="/requests" empty="서명할 계약서 · 반려된 요청이 없습니다" />
        <NoticeBox items={notices} />
      </div>
    </div>
  );
}
