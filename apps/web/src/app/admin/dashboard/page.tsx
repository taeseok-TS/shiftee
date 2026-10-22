"use client";
// 관리자 대시보드 — 본부 시안 R9(2026-10-21 「디자인 통일」 기준 화면). 본문은 박스 셋: 오늘 근태 · 결재함 · 공지사항.
//  · 숫자는 색칠하지 않는다 — 처리할 문제 숫자(지각·미출근·조퇴)만 1 이상일 때 빨강, 「전체 직원」은 연인디고
//  · 결재함 = 내가 승인·서명할 계약·휴가·근무일정·휴가 취소·출퇴근 요청 + 최근 7일 출퇴근 누락(빨간 줄, 누르면 자동 보정 확인)
//  · 뺀 것: 「직원 모드로 전환」 버튼(상단 바에 있음) · 관리 알림 · 대기 계약/휴가 카드 · 누락 큰 판 · 빠른 액세스 · 월간 리포트(동작하지 않던 버튼)
import { isSessionExpired } from "@/lib/session-expiry";
import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Clock, CheckSquare, Megaphone, Pin } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import { PageHead, Btn, Box, Tiles, Tile } from "@/components/kit";
import { useNavCounts } from "@/components/layout/useNavCounts";

type AttendanceStats = { present: number; late: number; absent: number; earlyLeave: number; onLeave: number };

type MissingAttendance = {
  id: string;
  name: string;
  email: string;
  date: string;
  type: string;            // 「출근 누락」·「퇴근 누락」 (#219-5)
  mode?: "in" | "out";     // 빠진 쪽 — 문구 비교 대신 이 값으로 가른다
  fillAt?: string | null;  // 보정하면 들어갈 시각(서버가 보정 API 와 같은 함수로 계산, #219-4)
  fillLabel?: string | null;
  pendingRequest?: boolean; // 직원 출퇴근 요청 결재 대기 — 보정하지 않는다
};

/** 결재함 한 줄 — 제목 + 회색 한 줄 + 「열기 ›」(R9) */
type Row = { key: string; title: string; sub: string; href?: string; onOpen?: () => void; alert?: boolean; at: number };

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
  const [filling, setFilling] = useState(false);

  // 공지사항 — 제목 · 작성자 · 날짜만, 누르면 펼침(R9)
  const [announcements, setAnnouncements] = useState<{ id: string; title: string; content: string; pinned: boolean; authorName: string; createdAt: string }[]>([]);
  const [openAnn, setOpenAnn] = useState<string | null>(null);
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
          next.push({ key: `contract-${c.id}`, title: c.title, sub: `계약 승인${due ? ` · 기한 ${due}` : ""}`, href: "/admin/contract-approvals", at: new Date(c.createdAt).getTime() });
        }
      }
      // 3. 출퇴근 요청(지점 밖·사진·본부·수정·퇴근 누락) — 결재함 「출퇴근 요청」과 같은 목록
      const reqRes = await fetch("/api/attendance-requests?scope=inbox").catch(() => null);
      if (reqRes?.ok) {
        const data = await reqRes.json();
        for (const r of (data.requests || []) as { id: string; status?: string; kindLabel?: string; workDate: string; userName?: string; requestedAt?: string }[]) {
          if (r.status && r.status !== "PENDING") continue;
          next.push({ key: `att-${r.id}`, title: `${r.userName ?? ""} · ${r.kindLabel ?? "출퇴근 요청"}`, sub: `출퇴근 요청 · ${r.workDate.slice(5).replace("-", "/")}`, href: "/admin/leave-approvals?tab=attendance", at: r.requestedAt ? new Date(r.requestedAt).getTime() : 0 });
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

  // 출퇴근 누락 자동 보정 — 그날 근무일정 시각으로(일정 없으면 보정 시간), 전일 미마감과 같은 기준(2026-10-16 #219-4)
  async function handleAutoFill() {
    if (!fillTarget) return;
    setFilling(true);
    try {
      const res = await fetch(`/api/attendance/${fillTarget.id}/auto-fill`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || "보정에 실패했습니다."); return; }
      toast.success(data.mode === "out" ? "퇴근 시간이 자동 입력되었습니다." : "출근 시간이 자동 입력되었습니다.");
      setFillTarget(null);
      fetchDashboardData();
    } finally {
      setFilling(false);
    }
  }

  const a = attendanceStats;
  const toAttendance = () => { window.location.href = "/admin/attendance"; };
  // 결재함 = 출퇴근 누락(빨간 줄, 먼저) + 결재 대기
  const missRows: Row[] = missing.filter((m) => !m.pendingRequest).map((m) => ({
    key: `miss-${m.id}`, title: `${m.name} · ${m.type}`, alert: true, at: 0,
    sub: `${format(new Date(m.date), "M/d")} 출퇴근 누락 · 누르면 자동 보정`,
    onOpen: () => setFillTarget(m),
  }));
  const shownRows = [...rows.slice(0, 8), ...missRows.slice(0, 5)];   // 결재 줄 8개 + 그 아래 누락 빨간 줄 5개까지
  const moreCount = Math.max(0, rows.length - 8) + Math.max(0, missRows.length - 5);

  return (
    <div>
      <PageHead title="대시보드" note={loadedAt ? `${format(loadedAt, "M월 d일 (EEE) HH:mm", { locale: ko })} 기준` : undefined}>
        <Btn kind="text" onClick={fetchDashboardData} disabled={loading}>{loading ? "불러오는 중…" : "새로고침"}</Btn>
      </PageHead>

      {/* 오늘 근태 — 한 판 6칸(R9). 누르면 출퇴근 현황 */}
      <Box icon={<Clock />} title="오늘 근태" sub="근무일정이 있는 직원 기준" right={<a href="/admin/attendance" className="text-[#4f46e5] hover:underline">출퇴근 현황 ›</a>}>
        <Tiles cols={6}>
          <Tile label="출근" value={a?.present} unit="명" onClick={toAttendance} />
          <Tile label="지각" value={a?.late} unit="명" alert onClick={toAttendance} />
          <Tile label="미출근" value={a?.absent} unit="명" note="일정 있는데 출근 전" alert onClick={toAttendance} />
          <Tile label="조퇴" value={a?.earlyLeave} unit="명" alert onClick={toAttendance} />
          <Tile label="휴가" value={a?.onLeave} unit="명" onClick={toAttendance} />
          <Tile label="전체 직원" value={totalEmployees} unit="명" note="관리자 제외" hl onClick={toAttendance} />
        </Tiles>
      </Box>

      <div className="grid gap-[18px] lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* 결재함 — 내가 승인할 것만, 다 끝나면 「처리할 것이 없어요」 한 줄 */}
        <Box icon={<CheckSquare />} tone="rose" title="결재함" count={typeof navCounts.approvals === "number" ? navCounts.approvals : rows.length} className="!mb-0 min-w-0"
          right={<a href="/admin/leave-approvals" className="text-[#4f46e5] hover:underline">전체 보기 ›</a>}>
          <div className="px-6 py-1">
            {loading && !shownRows.length ? (
              <p className="py-5 text-[14px] text-[#596578]">불러오는 중…</p>
            ) : !shownRows.length ? (
              <p className="py-5 text-[14px] text-[#596578]">처리할 것이 없어요.</p>
            ) : shownRows.map((r) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <b className={`block truncate text-[16px] font-bold ${r.alert ? "text-[#dc2626]" : "text-[#0f172a]"}`}>{r.title}</b>
                    <span className="block truncate text-[13.5px] text-[#596578]">{r.sub}</span>
                  </span>
                  <span className="shrink-0 text-[14.5px] font-semibold text-[#4f46e5]">열기 ›</span>
                </>
              );
              const cls = "flex w-full items-center gap-3.5 border-t border-[#f1f5f9] py-[15px] text-left first:border-t-0 hover:bg-[#fafbfd]";
              return r.href
                ? <a key={r.key} href={r.href} className={cls}>{body}</a>
                : <button key={r.key} type="button" onClick={r.onOpen} className={cls}>{body}</button>;
            })}
            {moreCount > 0 && <a href={rows.length > 8 ? "/admin/leave-approvals" : "/admin/attendance"} className="block border-t border-[#f1f5f9] py-3 text-center text-[13.5px] font-semibold text-[#4f46e5] hover:underline">{moreCount}건 더 보기 ›</a>}
          </div>
        </Box>

        {/* 공지사항 — 제목 · 작성자 · 날짜, 누르면 펼침 */}
        <Box icon={<Megaphone />} tone="amb" title="공지사항" className="!mb-0 min-w-0"
          right={<button type="button" onClick={() => setAnnOpen(true)} className="text-[#4f46e5] hover:underline">＋ 작성</button>}>
          <div className="px-6 py-1">
            {announcements.length === 0 ? (
              <p className="py-5 text-[14px] text-[#596578]">등록된 공지가 없습니다.</p>
            ) : announcements.map((n) => (
              <div key={n.id} className="border-t border-[#f1f5f9] first:border-t-0">
                <button type="button" onClick={() => setOpenAnn(openAnn === n.id ? null : n.id)} aria-expanded={openAnn === n.id}
                  className="flex w-full items-center gap-3.5 py-[15px] text-left">
                  <span className="min-w-0 flex-1">
                    <b className="flex items-center gap-1.5 truncate text-[16px] font-bold text-[#0f172a]">{n.pinned && <Pin size={14} className="shrink-0 text-[#4f46e5]" aria-label="고정" />}{n.title}</b>
                    <span className="block truncate text-[13.5px] text-[#596578]">{n.authorName}</span>
                  </span>
                  <span className="shrink-0 text-[13.5px] text-[#596578]">{format(new Date(n.createdAt), "M월 d일")}</span>
                </button>
                {openAnn === n.id && (
                  <div className="pb-4">
                    <p className="whitespace-pre-wrap text-[14px] text-[#334155]">{n.content}</p>
                    <a href="/work/announcements" className="mt-2 inline-block text-[13px] font-semibold text-[#4f46e5] hover:underline">큐브티워크에서 보기 ›</a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Box>
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

      {/* 출퇴근 누락 자동 보정 확인 다이얼로그 */}
      <Dialog open={!!fillTarget} onOpenChange={(o) => !o && setFillTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>출퇴근 누락 자동 보정</DialogTitle>
          </DialogHeader>
          {fillTarget && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-3 text-sm">
                <p className="font-medium">{fillTarget.name}</p>
                <p className="text-gray-500 text-xs">
                  {format(new Date(fillTarget.date), "yyyy년 M월 d일")} · {fillTarget.type}
                </p>
              </div>
              {fillTarget.pendingRequest ? (
                <p className="text-sm text-gray-700">
                  직원이 올린 출퇴근 요청이 결재 대기 중입니다. 자동 보정 대신 <b>결재 › 결재함</b>에서 처리해 주세요.
                </p>
              ) : (
                <div className="text-sm text-gray-700 space-y-1">
                  {/* 문구 비교 대신 mode 로 가른다(#219-5 에서 「퇴실 누락」→「퇴근 누락」으로 바뀌어도 어긋나지 않게) */}
                  <p>
                    {(fillTarget.mode ?? (fillTarget.type === "출근 누락" ? "in" : "out")) === "out" ? "기록될 퇴근" : "기록될 출근"}:{" "}
                    <b>{fillTarget.fillAt ? format(new Date(fillTarget.fillAt), "M월 d일 HH:mm") : "-"}</b>
                  </p>
                  {fillTarget.fillLabel && <p className="text-xs text-gray-500">기준: {fillTarget.fillLabel}</p>}
                  <p>이대로 기록하겠습니까?</p>
                </div>
              )}
              <div className="flex gap-2 justify-end">
                <Btn onClick={() => setFillTarget(null)} disabled={filling}>
                  {fillTarget.pendingRequest ? "닫기" : "아니오"}
                </Btn>
                {!fillTarget.pendingRequest && (
                  <Btn kind="primary" onClick={handleAutoFill} disabled={filling}>
                    {filling ? "처리 중..." : "네"}
                  </Btn>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
