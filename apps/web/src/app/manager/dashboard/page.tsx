"use client";
// 원장 대시보드 — 본부 시안 R16(2026-10-21 「디자인 통일」, 관리자 대시보드 R9 와 같은 세 박스): 우리 지점 근태 현황 · 결재함 · 공지사항.
//  · 숫자는 색칠하지 않는다 — 처리할 문제 숫자(지각 · 미출근 · 조퇴)만 1 이상일 때 빨강, 「지점 인원」은 연인디고
//  · 결재함 = 원장(나) 차례인 지점 휴가 · 근무 변경 · 휴가 취소 · 출퇴근 수정 · 지점 계약서.
//    둘째 줄은 단계 이름이 아니라 **내용**(「연차 · 11월 2일 (월) ~ 4일 (수) · 3일」) — 열지 않고도 판단(2026-10-23 오픈 전 요청 ■2, 시안 S2-1)
//  · 폰(lg 미만)에서는 결재함이 맨 위, 그다음 근태 현황 · 공지(■2). PC 는 근태 현황 → 결재함 · 공지 그대로
//  · 공지는 읽기만(작성은 본부). 뺀 것: 「팀 관리」 바로가기 4개(레일과 겹침) · 「금월 결근자」 카드 · 숫자 색칠
import { useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { PageHead, Btn, Box, Tiles, Tile } from "@/components/kit";
import { InboxBox, NoticeBox, useNotices, type InboxRow } from "@/components/dashboard/DashBoxes";
import { useNavCounts } from "@/components/layout/useNavCounts";
import { useLeaveCatalog } from "@/components/leave/useLeaveCatalog";
import { LEAVE_LABELS } from "@/lib/leave-catalog";
import { fmtDayKo, fmtRangeKo } from "@/lib/leave-period";
import { templateLabel } from "@/lib/schedule-label";

type TeamStats = {
  teamCount: number;
  attendance: { present: number; late: number; absent: number; beforeStart?: number; earlyLeave: number; onLeave: number };
  names?: { late: string[]; missing: string[]; beforeStart?: string[]; earlyLeave: string[] };   // 누구인지(#215-6)
  attendanceHidden?: boolean;   // 본부가 원장 출퇴근 열람을 꺼 둠(권한 설정 #39)
};
type Person = { id: string; name: string } | null;
type SchedEntry = { startTime?: string; endTime?: string };

// 이름 8명까지(타일 아래 회색 한 줄)
const namesNote = (list?: string[]) => (list && list.length ? `${list.slice(0, 8).join(", ")}${list.length > 8 ? ` 외 ${list.length - 8}명` : ""}` : undefined);
// 근무 변경 줄의 「근무 시간 또는 종류 이름」 — 종류 이름에 시간이 들어 있으면 그대로(templateLabel 이 두 번 표기를 막는다),
// 없으면 신청한 날짜별 시간(scheduleData)에서 「13:00–22:00」(날마다 다르면 「… 외 2」)
const schedDetail = (kind: string | undefined, templateName: string | null | undefined, data: unknown): string => {
  if (kind === "DELETE") return "일정 삭제";
  const name = templateLabel(templateName);
  if (/\d{1,2}:\d{2}/.test(name)) return name;
  const times = [...new Set((Array.isArray(data) ? (data as SchedEntry[]) : []).filter((e) => e?.startTime && e?.endTime).map((e) => `${e.startTime}–${e.endTime}`))];
  const t = times.length ? `${times[0]}${times.length > 1 ? ` 외 ${times.length - 1}` : ""}` : "";
  return [name, t].filter(Boolean).join(" · ");
};
// 기한(datetime) → KST 날짜 「10월 31일 (토)」
const dueLabel = (iso: string | null | undefined) => (iso ? fmtDayKo(new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString()) : null);

export default function ManagerDashboardPage() {
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [me, setMe] = useState<{ id: string; role: string; branch: string } | null>(null);
  const [rows, setRows] = useState<InboxRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const notices = useNotices(reloadKey);
  const navCounts = useNavCounts();
  useLeaveCatalog();   // 본부가 만든 유형 이름을 LEAVE_LABELS(공용 라이브 객체)에 채운다 — 받으면 다시 그린다
  const labels = LEAVE_LABELS;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const meRes = await fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const myId: string = meRes?.user?.id ?? "";
      setMe({ id: myId, role: meRes?.user?.role ?? "", branch: meRes?.user?.branch ?? "" });
      const get = (u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const [st, leave, sched, cancel, att, contracts] = await Promise.all([
        get("/api/manager/dashboard-stats"),
        get("/api/leave/my-approvals"),
        get("/api/schedule-requests/my-approvals"),
        get("/api/leave/cancel-requests/my-approvals"),
        get("/api/attendance-requests?scope=inbox"),
        get("/api/contracts/my-approvals"),
      ]);
      if (st) setStats(st);
      // 제목 = 「이름 · 요청 종류(근무 변경 · 휴가 · 출퇴근 수정)」, 둘째 줄 = 내용(시안 S2-1). 결재 흐름 글자는 뺐다(둘째 줄이 넘치지 않게 하나로)
      const next: InboxRow[] = [];
      for (const s of (leave?.steps || []) as { id: string; createdAt: string; leaveRequest: { id: string; type: string; startDate: string; endDate: string; days: number; user: Person } }[]) {
        const l = s.leaveRequest;
        next.push({ key: `leave-${s.id}`, title: `${l.user?.name ?? ""} · 휴가`,
          sub: `${labels[l.type] ?? l.type} · ${fmtRangeKo(l.startDate, l.endDate)} · ${l.days}일`, href: `/manager/team-leave?id=${encodeURIComponent(l.id)}`, at: new Date(s.createdAt).getTime() });
      }
      for (const s of (sched?.steps || []) as { id: string; createdAt: string; scheduleRequest: { kind?: string; templateName?: string | null; scheduleData?: unknown; startDate: string; endDate: string; user: Person } }[]) {
        const r = s.scheduleRequest;
        next.push({ key: `sched-${s.id}`, title: `${r.user?.name ?? ""} · 근무 변경`,
          sub: [fmtRangeKo(r.startDate, r.endDate), schedDetail(r.kind, r.templateName, r.scheduleData)].filter(Boolean).join(" · "), href: "/manager/team-leave?tab=schedule", at: new Date(s.createdAt).getTime() });
      }
      for (const s of (cancel?.steps || []) as { id: string; createdAt: string; cancelRequest?: { user?: Person; leaveRequest?: { type: string; startDate: string; endDate: string } } }[]) {
        const c = s.cancelRequest;
        const lr = c?.leaveRequest;
        next.push({ key: `cancel-${s.id}`, title: `${c?.user?.name ?? ""} · 휴가 취소`,
          sub: lr ? `${labels[lr.type] ?? lr.type} · ${fmtRangeKo(lr.startDate, lr.endDate)} 취소` : "휴가 취소 요청", href: "/manager/team-leave?tab=cancel", at: new Date(s.createdAt).getTime() });
      }
      // 출퇴근 수정 — 원장에게는 찍은 시각이 오지 않는다(■0-11, requestedAt · createdAt = null). 둘째 줄은 서버가 만든 시각 없는 요약(summary,
      // 「10월 23일 (금) 퇴근 누락 → 퇴근」) 그대로. 순서는 요청을 올린 때로 — 시각이 없으면 올린 날(createdDate, KST "YYYY-MM-DD")의 0시로
      // (0 으로 두면 맨 뒤로 밀려 8줄 안에서 잘렸다)
      for (const r of (att?.requests || []) as { id: string; status?: string; kindLabel?: string; summary?: string | null; statusSummary?: string | null; workDate: string; userName?: string; requestedAt?: string | null; createdAt?: string | null; createdDate?: string }[]) {
        if (r.status && r.status !== "PENDING") continue;
        const t = r.createdAt ?? r.requestedAt ?? (r.createdDate ? `${r.createdDate}T00:00:00+09:00` : null);
        next.push({ key: `att-${r.id}`, title: `${r.userName ?? ""} · 출퇴근 수정`, sub: r.statusSummary || `${fmtDayKo(r.workDate)} ${r.kindLabel ?? "출퇴근 수정"}`,   // 시각이 보이는 본부도 시각 없는 요약으로(줄마다 형식이 같게)
          href: "/manager/team-leave?tab=attendance", at: t ? new Date(t).getTime() : 0 });
      }
      for (const c of (contracts?.contracts || []) as { id: string; title: string; userId?: string; externalName?: string | null; signDeadline?: string | null; createdAt: string }[]) {
        const due = dueLabel(c.signDeadline);
        const mine = !!myId && c.userId === myId && !c.externalName;   // 원장 본인 계약서 — 서명은 직원 모드 「내 계약서」에서
        // 제목이 서류 이름이라 둘째 줄은 「지점 계약서 · 기한 10월 31일 (토)」(본인 것은 「내 계약서 · 서명 대기 · 기한 …」)
        next.push({ key: `contract-${c.id}`, title: c.title, sub: [mine ? "내 계약서 · 서명 대기" : "지점 계약서", due ? `기한 ${due}` : ""].filter(Boolean).join(" · "),
          href: mine ? `/contracts?sign=${encodeURIComponent(c.id)}` : `/manager/team-contracts?id=${encodeURIComponent(c.id)}`, action: mine ? "서명" : undefined, at: new Date(c.createdAt).getTime() });
      }
      setRows(next.sort((a, b) => b.at - a.at));
      if (st) setLoadedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, [labels]);   // labels = 같은 객체(바뀌지 않음) — 이름이 늦게 오면 다음 새로고침에서

  useEffect(() => { Promise.resolve().then(load); }, [load]);   // 첫 읽기(렌더 중 setState 회피 — lint set-state-in-effect)

  const refresh = () => { setReloadKey((k) => k + 1); load(); };
  const hidden = !!stats?.attendanceHidden;
  const a = stats && !hidden ? stats.attendance : null;
  const toAttendance = hidden ? undefined : () => { window.location.href = "/manager/team-attendance"; };
  const shown = rows.slice(0, 8);
  const inboxCount = typeof navCounts.approvals === "number" ? navCounts.approvals : rows.length;

  return (
    <div>
      <PageHead title="대시보드" note={loadedAt ? `${format(loadedAt, "M월 d일 (EEE) HH:mm", { locale: ko })} 기준` : undefined}>
        <Btn kind="text" onClick={refresh} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</Btn>
      </PageHead>

      {/* 한 격자 — 폰(lg 미만)은 결재함 → 근태 현황 → 공지 순(order), PC(lg)는 근태 현황이 두 칸을 다 차지하고 아래 결재함 · 공지 */}
      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* 지점 근태 — 7칸(R16 + 「출근 전」, 폰은 Tiles 가 2열로 접는다). 제목은 관리자 「오늘 근태」 · 직원 「내 근태」와 같은 꼴(2026-10-27 이예지 ⑦). 출퇴근 열람이 꺼지면 휴가 · 지점 인원만 */}
        <Box icon={<Clock />} title="지점 근태" sub={hidden ? "본부 설정으로 출퇴근 숫자는 보이지 않습니다" : "근무일정이 있는 직원 기준 · 루트코스 교육 중인 신입 제외"}
          className="order-2 !mb-0 min-w-0 lg:order-none lg:col-span-2"
          right={hidden ? undefined : <a href="/manager/team-attendance" className="text-[#4f46e5] hover:underline">지점 출퇴근기록 ›</a>}>
          <Tiles cols={7}>
            <Tile label="출근" value={a?.present} unit="명" onClick={toAttendance} />
            <Tile label="지각" value={a?.late} unit="명" note={namesNote(stats?.names?.late)} alert onClick={toAttendance} />
            {/* 근무 시작 전인 사람은 미출근이 아니라 「출근 전」(2026-10-27 이예지 ① — 오전에 13:00 근무자 107명이 미출근으로 떠 원장님들이 놀랄 일) */}
            <Tile label="출근 전" value={hidden ? null : a?.beforeStart ?? 0} unit="명" note={hidden ? undefined : namesNote(stats?.names?.beforeStart) ?? "근무 시작 시각 전"} onClick={toAttendance} />
            <Tile label="미출근" value={a?.absent} unit="명" note={hidden ? undefined : namesNote(stats?.names?.missing) ?? "시작 시각 지났는데 기록 없음"} alert onClick={toAttendance} />
            <Tile label="조퇴" value={a?.earlyLeave} unit="명" note={namesNote(stats?.names?.earlyLeave)} alert onClick={toAttendance} />
            <Tile label="휴가" value={stats?.attendance.onLeave} unit="명" />
            {/* 원장 = 담당 지점 재직자, 본부 계정으로 원장 모드를 열면 전체(본부 · 테스트 지점 제외) */}
            <Tile label="지점 인원" value={stats?.teamCount} unit="명" note={me?.role === "ADMIN" ? "본부 계정 — 전체 지점" : "지점 재직 · 휴직 빼고"} hl
              onClick={() => { window.location.href = "/manager/team-employees"; }} />
          </Tiles>
        </Box>

        <div className="order-1 min-w-0 lg:order-none">
          <InboxBox rows={shown} loading={loading} count={inboxCount} allHref="/manager/team-leave"
            more={Math.max(0, rows.length - shown.length)} moreHref="/manager/team-leave" />
        </div>
        <div className="order-3 min-w-0 lg:order-none">
          <NoticeBox items={notices} />
        </div>
      </div>
    </div>
  );
}
