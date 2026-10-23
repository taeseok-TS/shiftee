"use client";
// 원장 대시보드 — 본부 시안 R16(2026-10-21 「디자인 통일」, 관리자 대시보드 R9 와 같은 세 박스): 우리 지점 근태 현황 · 결재함 · 공지사항.
//  · 숫자는 색칠하지 않는다 — 처리할 문제 숫자(지각 · 미출근 · 조퇴)만 1 이상일 때 빨강, 「지점 인원」은 연인디고
//  · 결재함 = 원장(나) 차례인 지점 휴가 · 근무일정 · 휴가 취소 · 출퇴근 요청 · 지점 계약서. 줄 회색 한 줄에 결재 흐름(「원장(나) → 본부」)
//  · 공지는 읽기만(작성은 본부). 뺀 것: 「팀 관리」 바로가기 4개(레일과 겹침) · 「금월 결근자」 카드 · 숫자 색칠
import { useCallback, useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { PageHead, Btn, Box, Tiles, Tile } from "@/components/kit";
import { InboxBox, NoticeBox, useNotices, periodLabel, type InboxRow } from "@/components/dashboard/DashBoxes";
import { useNavCounts } from "@/components/layout/useNavCounts";
import { useLeaveCatalog } from "@/components/leave/useLeaveCatalog";
import { LEAVE_LABELS } from "@/lib/leave-catalog";

type TeamStats = {
  teamCount: number;
  attendance: { present: number; late: number; absent: number; earlyLeave: number; onLeave: number };
  names?: { late: string[]; missing: string[]; earlyLeave: string[] };   // 누구인지(#215-6)
  attendanceHidden?: boolean;   // 본부가 원장 출퇴근 열람을 꺼 둠(권한 설정 #39)
};
type Person = { id: string; name: string } | null;
type StepLite = { approverId?: string | null; approverRole?: string | null; status: string };

const SCHED_KIND: Record<string, string> = { CREATE: "근무일정 신청", UPDATE: "근무일정 수정", DELETE: "근무일정 삭제" };
// 이름 8명까지(타일 아래 회색 한 줄)
const namesNote = (list?: string[]) => (list && list.length ? `${list.slice(0, 8).join(", ")}${list.length > 8 ? ` 외 ${list.length - 8}명` : ""}` : undefined);

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

  // 결재 흐름 한 줄 — 역할 글자(원장 · 본부)는 approverRole, 「(나)」는 지금 대기 중인 단계(결재함에 떴으니 내 차례).
  //   원장 단계는 사람을 못박지 않아 approverId 가 비어 있으므로 approverId 로 「나」를 판단하지 않는다(R16 검증 1)
  const flowOf = useCallback((steps: StepLite[] | undefined, myRole: string) => (steps || [])
    .map((st) => `${st.approverRole === "ADMIN" ? "본부" : st.approverRole === "MANAGER" ? "원장" : "결재자"}${st.status === "PENDING" && (!st.approverRole || st.approverRole === myRole) ? "(나)" : ""}`)
    .join(" → "), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const meRes = await fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const myId: string = meRes?.user?.id ?? "";
      const myRole: string = meRes?.user?.role ?? "";
      const withFlow = (head: string, steps: StepLite[] | undefined) => { const f = flowOf(steps, myRole); return f ? `${head} · ${f}` : head; };
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
      const next: InboxRow[] = [];
      for (const s of (leave?.steps || []) as { id: string; createdAt: string; leaveRequest: { id: string; type: string; startDate: string; endDate: string; days: number; user: Person; approvalSteps?: StepLite[] } }[]) {
        const l = s.leaveRequest;
        next.push({ key: `leave-${s.id}`, title: `${l.user?.name ?? ""} · ${labels[l.type] ?? l.type} ${periodLabel(l.startDate, l.endDate)}${l.days > 1 ? ` (${l.days}일)` : ""}`,
          sub: withFlow("지점 휴가 승인", l.approvalSteps), href: `/manager/team-leave?id=${encodeURIComponent(l.id)}`, at: new Date(s.createdAt).getTime() });
      }
      for (const s of (sched?.steps || []) as { id: string; createdAt: string; scheduleRequest: { kind?: string; startDate: string; endDate: string; user: Person; approvalSteps?: StepLite[] } }[]) {
        const r = s.scheduleRequest;
        next.push({ key: `sched-${s.id}`, title: `${r.user?.name ?? ""} · ${SCHED_KIND[r.kind ?? "CREATE"] ?? "근무일정"} ${periodLabel(r.startDate, r.endDate)}`,
          sub: withFlow("지점 근무일정 승인", r.approvalSteps), href: "/manager/team-leave?tab=schedule", at: new Date(s.createdAt).getTime() });
      }
      for (const s of (cancel?.steps || []) as { id: string; createdAt: string; cancelRequest?: { user?: Person; leaveRequest?: { type: string; startDate: string; endDate: string } } }[]) {
        const c = s.cancelRequest;
        const lr = c?.leaveRequest;
        next.push({ key: `cancel-${s.id}`, title: `${c?.user?.name ?? ""} · 휴가 취소${lr ? ` ${labels[lr.type] ?? lr.type} ${periodLabel(lr.startDate, lr.endDate)}` : ""}`,
          sub: "지점 휴가 취소 승인", href: "/manager/team-leave?tab=cancel", at: new Date(s.createdAt).getTime() });
      }
      for (const r of (att?.requests || []) as { id: string; status?: string; kindLabel?: string; workDate: string; userName?: string; requestedAt?: string }[]) {
        if (r.status && r.status !== "PENDING") continue;
        next.push({ key: `att-${r.id}`, title: `${r.userName ?? ""} · ${r.kindLabel ?? "출퇴근 요청"}`, sub: `출퇴근 요청 승인 · ${periodLabel(r.workDate, r.workDate)}`,
          href: "/manager/team-leave?tab=attendance", at: r.requestedAt ? new Date(r.requestedAt).getTime() : 0 });
      }
      for (const c of (contracts?.contracts || []) as { id: string; title: string; userId?: string; externalName?: string | null; signDeadline?: string | null; createdAt: string }[]) {
        const due = c.signDeadline ? new Date(new Date(c.signDeadline).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 10).replace("-", "/") : null;   // 시안 「기한 11/04」(관리자 · 직원 대시보드와 같게)
        const mine = !!myId && c.userId === myId && !c.externalName;   // 원장 본인 계약서 — 서명은 직원 모드 「내 계약서」에서
        next.push({ key: `contract-${c.id}`, title: c.title, sub: `${mine ? "서명할 내 계약서" : "지점 계약서 승인"}${due ? ` · 기한 ${due}` : ""}`,
          href: mine ? `/contracts?sign=${encodeURIComponent(c.id)}` : "/manager/team-contracts", action: mine ? "서명" : undefined, at: new Date(c.createdAt).getTime() });
      }
      setRows(next.sort((a, b) => b.at - a.at));
      if (st) setLoadedAt(new Date());
    } finally {
      setLoading(false);
    }
  }, [flowOf, labels]);   // labels = 같은 객체(바뀌지 않음) — 이름이 늦게 오면 다음 새로고침에서

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

      {/* 우리 지점 근태 현황 — 6칸(R16). 출퇴근 열람이 꺼지면 휴가 · 지점 인원만 */}
      <Box icon={<Clock />} title="우리 지점 근태 현황" sub={hidden ? "본부 설정으로 출퇴근 숫자는 보이지 않습니다" : "근무일정이 있는 직원 기준"}
        right={hidden ? undefined : <a href="/manager/team-attendance" className="text-[#4f46e5] hover:underline">지점 출퇴근기록 ›</a>}>
        <Tiles cols={6}>
          <Tile label="출근" value={a?.present} unit="명" onClick={toAttendance} />
          <Tile label="지각" value={a?.late} unit="명" note={namesNote(stats?.names?.late)} alert onClick={toAttendance} />
          <Tile label="미출근" value={a?.absent} unit="명" note={hidden ? undefined : namesNote(stats?.names?.missing) ?? "일정 있는데 출근 전"} alert onClick={toAttendance} />
          <Tile label="조퇴" value={a?.earlyLeave} unit="명" note={namesNote(stats?.names?.earlyLeave)} alert onClick={toAttendance} />
          <Tile label="휴가" value={stats?.attendance.onLeave} unit="명" />
          {/* 원장 = 담당 지점 재직자, 본부 계정으로 원장 모드를 열면 전체(본부 · 테스트 지점 제외) */}
          <Tile label="지점 인원" value={stats?.teamCount} unit="명" note={me?.role === "ADMIN" ? "본부 계정 — 전체 지점" : "우리 지점 재직"} hl
            onClick={() => { window.location.href = "/manager/team-employees"; }} />
        </Tiles>
      </Box>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <InboxBox rows={shown} loading={loading} count={inboxCount} allHref="/manager/team-leave"
          more={Math.max(0, rows.length - shown.length)} moreHref="/manager/team-leave" />
        <NoticeBox items={notices} />
      </div>
    </div>
  );
}
