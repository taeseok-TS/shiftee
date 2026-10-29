"use client";
// 관리자 대시보드 — 본부 시안 R9(2026-10-21 「디자인 통일」 기준 화면). 본문은 박스 셋: 오늘 근태 · 결재함 · 공지사항.
//  · 숫자는 색칠하지 않는다 — 처리할 문제 숫자(지각·미출근·조퇴)만 1 이상일 때 빨강, 「전체 직원」은 연인디고
//  · 결재함 = 내가 승인·서명할 계약·휴가·근무일정·휴가 취소·출퇴근 요청 + 최근 7일 출퇴근 누락(빨간 줄, 누르면 사람이 시각을 넣는 보정 창)
//  · 뺀 것: 「직원 모드로 전환」 버튼(상단 바에 있음) · 관리 알림 · 대기 계약/휴가 카드 · 누락 큰 판 · 빠른 액세스 · 월간 리포트(동작하지 않던 버튼)
import { isSessionExpired } from "@/lib/session-expiry";
import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import { PageHead, Btn, Box, Tiles, Tile } from "@/components/kit";
import { InboxBox, NoticeBox, type InboxRow, type Notice } from "@/components/dashboard/DashBoxes";
import { useNavCounts } from "@/components/layout/useNavCounts";
import MissingFixDialog, { type MissingAttendance } from "@/components/attendance/MissingFixDialog";

type AttendanceStats = { present: number; late: number; absent: number; beforeStart?: number; earlyLeave: number; onLeave: number };


/** 결재함 한 줄 — 제목 + 회색 한 줄 + 「열기 ›」(R9, 공용 components/dashboard/DashBoxes) */
type Row = InboxRow;

export default function AdminDashboardPage() {
  const [attendanceStats, setAttendanceStats] = useState<AttendanceStats | null>(null);
  const [totalEmployees, setTotalEmployees] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [missing, setMissing] = useState<MissingAttendance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const navCounts = useNavCounts();   // 결재함 숫자 = 사이드바 「결재함」이 이미 받은 값(같은 숫자 보장, 요청 하나 덜)

  // 출퇴근 누락 보정 확인
  const [fillTarget, setFillTarget] = useState<MissingAttendance | null>(null);

  // 공지사항 — 제목 · 작성자 · 날짜만, 누르면 펼침(R9)
  const [announcements, setAnnouncements] = useState<Notice[]>([]);
  const [annOpen, setAnnOpen] = useState(false);
  const [annForm, setAnnForm] = useState({ title: "", content: "", pinned: false });
  const [annSaving, setAnnSaving] = useState(false);

  const dashIvRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      // 1. 오늘 근태 + 대기 결재(휴가·근무일정·휴가 취소) + 최근 7일 누락
      const statsRes = await fetch("/api/admin/dashboard-stats");
      // 세션이 끊기면 멈춘다 — 종전에는 낡은 근무 현황을 현재로 계속 보여줬다 (2026-09-04)
      if (isSessionExpired(statsRes)) { if (dashIvRef.current) clearInterval(dashIvRef.current); return; }
      const next: Row[] = [];
      let miss: MissingAttendance[] = [];
      let fresh = statsRes.ok;
      // 근태·결재 묶음을 못 받으면 앞서 받은 목록을 그대로 둔다(「처리할 것이 없어요」로 덮지 않게)
      if (!statsRes.ok) { toast.error("오늘 근태를 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요."); return; }
      if (statsRes.ok) {
        const data = await statsRes.json();
        setAttendanceStats(data.attendance || null);
        setTotalEmployees(data.totalEmployees ?? null);
        miss = data.missingAttendance || [];
        for (const p of (data.pendingItems || []) as { id: string; type: string; title: string; requester: string; requestedAt: string; note?: string }[]) {
          next.push({
            key: `${p.type}-${p.id}`, title: `${p.requester} · ${p.title}`, sub: p.note || "승인",
            href: p.type === "leaveCancel" ? "/admin/leave-approvals?tab=cancel" : p.type === "schedule" ? "/admin/leave-approvals?tab=schedule" : `/admin/leave-approvals?tab=leave&id=${encodeURIComponent(p.id)}`,
            at: new Date(p.requestedAt).getTime(),
          });
        }
      }
      // 2. 계약 — 내가 승인·서명할 것
      const approvalRes = await fetch("/api/contracts/my-approvals");
      if (!approvalRes.ok) { fresh = false; toast.error("계약 결재 대기를 불러오지 못했습니다."); }
      if (approvalRes.ok) {
        const data = await approvalRes.json();
        for (const c of (data.contracts || []) as { id: string; title: string; signDeadline?: string | null; createdAt: string }[]) {
          const due = c.signDeadline ? new Date(new Date(c.signDeadline).getTime() + 9 * 3600 * 1000).toISOString().slice(5, 10).replace("-", "/") : null;
          next.push({ key: `contract-${c.id}`, title: c.title, sub: `계약 승인${due ? ` · 기한 ${due}` : ""}`, href: `/admin/leave-approvals?tab=contract&id=${encodeURIComponent(c.id)}`, at: new Date(c.createdAt).getTime() });
        }
      }
      // 3. 출퇴근 요청(지점 밖·사진·본부·수정·퇴근 누락) — 결재함 「출퇴근 요청」과 같은 목록
      const reqRes = await fetch("/api/attendance-requests?scope=inbox").catch(() => null);
      if (reqRes?.ok) {
        const data = await reqRes.json();
        // 제목은 「이름 · 출퇴근 수정」(요청 종류 세 가지 ■4), 둘째 줄은 시각 없는 요약(「10월 23일 (금) 퇴근 누락 → 퇴근」) — 원장 대시보드와 같은 모양
        for (const r of (data.requests || []) as { id: string; status?: string; currentStep?: string | null; kindLabel?: string; statusSummary?: string | null; workDate: string; userName?: string; requestedAt?: string | null; createdAt?: string | null; createdDate?: string }[]) {
          if (r.status && r.status !== "PENDING") continue;
          if (r.currentStep === "MANAGER") continue;   // 원장 차례 건은 본부 결재 대기가 아니다(2026-10-27 이예지 ⑬ — nav-counts · 결재함과 같은 기준)
          const [wy, wm, wd] = r.workDate.split("-").map(Number);
          const wk = ["일", "월", "화", "수", "목", "금", "토"][new Date(Date.UTC(wy, wm - 1, wd)).getUTCDay()];
          next.push({ key: `att-${r.id}`, title: `${r.userName ?? ""} · 출퇴근 수정`, sub: r.statusSummary || `${wm}월 ${wd}일 (${wk}) ${r.kindLabel ?? "출퇴근 수정"}`, href: "/admin/leave-approvals?tab=attendance", at: ((t) => (t ? new Date(t).getTime() : 0))(r.requestedAt ?? r.createdAt ?? (r.createdDate ? `${r.createdDate}T00:00:00+09:00` : null)) });
        }
      }
      setRows(next.sort((a, b) => b.at - a.at));
      setMissing(miss);
      // 4. 공지(큐브티워크 공지와 같은 자료)
      const annRes = await fetch("/api/work/announcements");
      if (annRes.ok) {
        const data = await annRes.json();
        setAnnouncements((data.announcements || []).slice(0, 5));
      }
      if (fresh) setLoadedAt(new Date());
    } catch (error) {
      console.error("Dashboard data fetch error:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  async function saveAnnouncement() {
    if (!annForm.title.trim() || !annForm.content.trim()) { toast.error("제목과 내용을 입력해주세요."); return; }
    setAnnSaving(true);
    try {
      const res = await fetch("/api/work/announcements", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(annForm),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "등록 실패"); return; }
      toast.success("공지가 등록되었습니다.");
      setAnnOpen(false); setAnnForm({ title: "", content: "", pinned: false });
      fetchDashboardData();
    } finally { setAnnSaving(false); }
  }

  useEffect(() => {
    fetchDashboardData();
    // 5분마다 새로고침
    const interval = setInterval(fetchDashboardData, 5 * 60 * 1000);
    dashIvRef.current = interval;
    return () => clearInterval(interval);
  }, [fetchDashboardData]);

  const a = attendanceStats;
  const toAttendance = () => { window.location.href = "/admin/attendance"; };
  // 결재함 = 출퇴근 누락(빨간 줄, 먼저) + 결재 대기
  const missRows: Row[] = missing.filter((m) => !m.pendingRequest).map((m) => ({
    key: `miss-${m.id}`, title: `${m.name} · ${m.type}`, alert: true, at: 0,
    sub: `${format(new Date(m.date), "M/d")} 출퇴근 누락 · 눌러서 시각 입력`,
    onOpen: () => setFillTarget(m),
  }));
  const shownRows = [...rows.slice(0, 8), ...missRows.slice(0, 5)];   // 결재 줄 8개 + 그 아래 누락 빨간 줄 5개까지
  const moreCount = Math.max(0, rows.length - 8) + Math.max(0, missRows.length - 5);

  return (
    <div>
      <PageHead title="대시보드" note={loadedAt ? `${format(loadedAt, "M월 d일 (EEE) HH:mm", { locale: ko })} 기준` : undefined}>
        <Btn kind="text" onClick={fetchDashboardData} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</Btn>
      </PageHead>

      {/* 오늘 근태 — 한 판 7칸(R9 + 「출근 전」, 2026-10-27 이예지 ①: 근무 시작 전인 사람은 미출근이 아니다). 누르면 출퇴근 현황 */}
      <Box icon={<Clock />} title="오늘 근태" sub="근무일정이 있는 직원 기준 · 루트코스 교육 중인 신입 제외" right={<a href="/admin/attendance" className="text-[#4f46e5] hover:underline">출퇴근 현황 ›</a>}>
        <Tiles cols={7}>
          <Tile label="출근" value={a?.present} unit="명" onClick={toAttendance} />
          <Tile label="지각" value={a?.late} unit="명" onClick={toAttendance} />
          <Tile label="출근 전" value={a ? (a.beforeStart ?? 0) : undefined} unit="명" note="근무 시작 시각 전" onClick={toAttendance} />
          <Tile label="미출근" value={a?.absent} unit="명" note="시작 시각 지났는데 기록 없음" onClick={toAttendance} />
          <Tile label="조퇴" value={a?.earlyLeave} unit="명" onClick={toAttendance} />
          <Tile label="휴가" value={a?.onLeave} unit="명" onClick={toAttendance} />
          <Tile label="전체 직원" value={totalEmployees} unit="명" note="지점 재직 + 휴직" hl onClick={toAttendance} />
        </Tiles>
      </Box>

      <div className="grid items-start gap-[18px] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* 결재함 — 내가 승인할 것만, 다 끝나면 「처리할 요청 없음」 한 줄 */}
        <InboxBox rows={shownRows} loading={loading} count={typeof navCounts.approvals === "number" ? navCounts.approvals : rows.length}
          allHref="/admin/leave-approvals" more={moreCount} moreHref={rows.length > 8 ? "/admin/leave-approvals" : "/admin/attendance"} />

        {/* 공지사항 — 제목 · 작성자 · 날짜, 누르면 펼침 */}
        <NoticeBox items={announcements} right={<button type="button" onClick={() => setAnnOpen(true)} className="text-[#4f46e5] hover:underline">＋ 작성</button>} />
      </div>

      {/* 공지 작성 다이얼로그 */}
      <Dialog open={annOpen} onOpenChange={setAnnOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>공지 작성</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <Input placeholder="제목" value={annForm.title} onChange={(e) => setAnnForm(f => ({ ...f, title: e.target.value }))} />
            <Textarea placeholder="내용" rows={6} value={annForm.content} onChange={(e) => setAnnForm(f => ({ ...f, content: e.target.value }))} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={annForm.pinned} onChange={(e) => setAnnForm(f => ({ ...f, pinned: e.target.checked }))} />
              상단 고정
            </label>
            <p className="text-xs text-gray-400">작성한 공지는 큐브티워크 &gt; 공지에도 함께 표시됩니다.</p>
            <div className="flex gap-2 justify-end">
              <Btn onClick={() => setAnnOpen(false)} disabled={annSaving}>취소</Btn>
              <Btn kind="primary" onClick={saveAnnouncement} disabled={annSaving}>{annSaving ? "등록 중..." : "등록"}</Btn>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* 출퇴근 누락 보정 창 — 사람이 시각·사유를 넣고 저장(자동으로 넣지 않는다, components/attendance/MissingFixDialog) */}
      <MissingFixDialog key={fillTarget?.id ?? "none"} target={fillTarget} onClose={() => setFillTarget(null)} onSaved={() => { setFillTarget(null); fetchDashboardData(); }} />
    </div>
  );
}
