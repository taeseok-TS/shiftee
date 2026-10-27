"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Btn, FlowDots, inputClass } from "@/components/kit";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * 출퇴근 요청 결재함(2026-10-07 QA #9 #13 #15) — 관리자 결재함(admin/leave-approvals)과 원장 결재함
 * (manager/team-leave, 원장대행 /approvals)이 **같은 컴포넌트**를 쓴다.
 * 데이터: GET /api/attendance-requests?scope=inbox · 처리: POST /api/attendance-requests/[id]
 * 승인하면 요청의 시각으로 출퇴근 기록이 생기거나 고쳐진다(기기 변경은 새 기기로 등록).
 * 출퇴근 수정(기록 고치기 · 퇴근 누락)은 「지점 원장 → 본부」(■0-11): 원장은 시각 없이 상태만 보고 1차 승인,
 * 본부는 승인 창에서 직원이 적은 시각을 확인 · 고쳐 최종 승인한다(POST clockIn · clockOut "HH:mm").
 */

type Req = {
  id: string; userName: string; userBranch: string | null; userPosition: string | null;
  kind: string; kindLabel: string; action: string | null; summary: string; reason: string | null; memo: string | null;
  hasPhoto: boolean; deviceName: string | null; platform: string | null; approverLabel: string; createdAt: string | null;
  // 시각을 숨기는 사람(원장 · 원장대행)에게 서버가 createdAt 대신 주는 날짜("YYYY-MM-DD")
  createdDate?: string | null;
  // ■0-11 — 시각은 본부에게만(직원 · 원장 응답은 null). 두 단계 결재 흐름
  clockIn?: string | null; clockOut?: string | null; wantIn?: boolean; wantOut?: boolean;
  timesHidden?: boolean; recordState?: string | null;
  steps?: number; currentStep?: "MANAGER" | "HQ" | null; nextStep?: "HQ" | null;
  step1?: { name: string; at: string } | null;
};

const TWO_STEP = new Set(["CORRECTION", "MISSED_OUT"]);
const KST_MS = 9 * 3600_000;
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
/** 실제 시각(ISO) → KST "HH:mm" */
const hhmmOf = (iso: string | null | undefined) => (iso ? new Date(new Date(iso).getTime() + KST_MS).toISOString().slice(11, 16) : "");
/** 실제 시각(ISO) → 「10/23 (금) 14:05」 */
const shortAt = (iso: string) => {
  const k = new Date(new Date(iso).getTime() + KST_MS);
  return `${k.getUTCMonth() + 1}/${k.getUTCDate()} (${WEEK[k.getUTCDay()]}) ${k.toISOString().slice(11, 16)}`;
};
/** 요청한 때 — 시각을 숨기는 사람(timesHidden)에게는 날짜만 「10/23 (금)」, 본부는 「10/23 (금) 14:05」 */
const requestedAt = (r: Req) => {
  const ymd = r.createdDate || (r.createdAt ? new Date(new Date(r.createdAt).getTime() + KST_MS).toISOString().slice(0, 10) : "");
  if (!ymd) return "";
  if (r.timesHidden || !r.createdAt) {
    const d = new Date(`${ymd.slice(0, 10)}T00:00:00Z`);
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()} (${WEEK[d.getUTCDay()]})`;
  }
  return shortAt(r.createdAt);
};

const KIND_COLOR: Record<string, string> = {
  OUTSIDE: "bg-amber-100 text-amber-800", PHOTO: "bg-sky-100 text-sky-800", HQ: "bg-violet-100 text-violet-800",
  CORRECTION: "bg-gray-100 text-gray-800", MISSED_OUT: "bg-rose-100 text-rose-800", DEVICE: "bg-indigo-50 text-indigo-700",
};

// onChanged — 처리한 뒤 부르는 화면이 자기 목록·건수를 다시 받게(관리자 결재함 「결재 대기」 탭)
// hideManagerTurn — 본부 결재함: 원장 차례(currentStep MANAGER) 건은 「원장 승인 전」 탭에서만 보이고 여기서는 뺀다(2026-10-27 이예지 ⑬)
export default function AttendanceRequestInbox({ onCount, onChanged, searchName = "", hideManagerTurn = false }: { onCount?: (n: number) => void; onChanged?: () => void; searchName?: string; hideManagerTurn?: boolean }) {
  const [rows, setRows] = useState<Req[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<Req | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  // 본부(ADMIN)만 최종 승인 때 시각을 확인 · 고친다 — 원장 · 원장대행은 시각 없이 승인.
  // null = 아직 모름(/api/auth/me 도착 전) — 그동안은 승인 버튼을 막는다(시각 확인 없이 최종 승인되지 않게)
  const [isHq, setIsHq] = useState<boolean | null>(null);
  const [approving, setApproving] = useState<Req | null>(null);
  const [fixIn, setFixIn] = useState("");
  const [fixOut, setFixOut] = useState("");
  useEffect(() => {
    fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null)).then((d) => setIsHq(d?.user?.role === "ADMIN")).catch(() => setIsHq(false));
  }, []);

  const fetchRows = () =>
    fetch("/api/attendance-requests?scope=inbox").then((r) => (r.ok ? r.json() : { requests: [] })).catch(() => ({ requests: [] }));
  const apply = useCallback((d: { requests?: Req[] }) => {
    const list = (d.requests || []).filter((r) => !hideManagerTurn || r.currentStep !== "MANAGER");
    setRows(list);
    onCount?.(list.length);
    setLoading(false);
  }, [onCount, hideManagerTurn]);
  const load = useCallback(async () => apply(await fetchRows()), [apply]);
  useEffect(() => {
    fetchRows().then(apply);
  }, [apply]);

  const shown = useMemo(() => {
    const s = searchName.trim().toLowerCase();
    return s ? rows.filter((r) => r.userName.toLowerCase().includes(s)) : rows;
  }, [rows, searchName]);

  const decide = async (r: Req, action: "approve" | "reject", reason?: string, times?: { clockIn?: string; clockOut?: string }) => {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/attendance-requests/${r.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason || undefined, ...(times ?? {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "처리하지 못했습니다."); return; }
      // 출퇴근 수정을 원장이 승인하면 본부 차례로 넘어간다(■0-11) — 서버 문구(message)를 그대로
      toast.success(d.message || (action === "approve" ? "승인했습니다." : "반려했습니다."));
      setRejecting(null);
      setRejectReason("");
      setApproving(null);
      load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  };

  // 본부가 출퇴근 수정을 승인할 때는 시각 확인 창부터(직원이 적은 시각을 미리 채운다).
  // 판정은 줄의 차례로 — 본부 차례(currentStep "HQ")이고 시각이 실려 왔으면(timesHidden !== true) 창을 띄운다.
  // 옛 서버(currentStep 없음)만 보는 사람이 본부인지로 가른다.
  const needsTimeCheck = (r: Req) =>
    TWO_STEP.has(r.kind) && r.timesHidden !== true && (r.currentStep === "HQ" || isHq === true);   // 본부는 원장 차례 건을 바로 처리해도 늘 시각 확인을 거친다(10/23 재검증 1)
  const roleUnknown = isHq === null;
  const onApprove = (r: Req) => {
    if (roleUnknown) return;
    if (!needsTimeCheck(r)) { decide(r, "approve"); return; }
    setFixIn(hhmmOf(r.clockIn));
    setFixOut(hhmmOf(r.clockOut));
    setApproving(r);
  };
  const sendApprove = () => {
    if (!approving) return;
    const times: { clockIn?: string; clockOut?: string } = {};
    // 바꾼 칸만 보낸다 — 그대로면 서버가 요청의 시각을 쓴다
    if (approving.kind === "CORRECTION" && fixIn && fixIn !== hhmmOf(approving.clockIn)) times.clockIn = fixIn;
    if (fixOut && fixOut !== hhmmOf(approving.clockOut)) times.clockOut = fixOut;
    decide(approving, "approve", undefined, times);
  };
  const approveBlocked = !!approving && (approving.kind === "MISSED_OUT" ? !fixOut : !fixIn && !fixOut);

  if (loading) return <div className="py-10 text-center text-gray-400"><Loader2 className="inline animate-spin" size={18} /> 불러오는 중…</div>;
  if (shown.length === 0) return <Card><CardContent className="py-10 text-center text-gray-400">결재할 출퇴근 수정 요청이 없습니다.</CardContent></Card>;

  return (
    <div className="space-y-3">
      {shown.map((r) => (
        <Card key={r.id}>
          <CardContent className="py-4 flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold">{r.userName}</span>
                <span className="text-xs text-gray-500">{r.userBranch ?? "-"}{r.userPosition ? ` · ${r.userPosition}` : ""}</span>
                <Badge className={KIND_COLOR[r.kind] ?? ""}>{r.kindLabel}</Badge>
                <span className="text-xs text-gray-400">결재: {r.approverLabel}</span>
              </div>
              {/* 두 단계(원장 → 본부) — 끝난 단계 파랑 · 지금 차례 주황 */}
              {(r.steps ?? 1) > 1 && r.currentStep && (
                <FlowDots steps={[
                  { label: "지점 원장", state: r.currentStep === "HQ" ? "done" : "now" },
                  { label: "본부", state: r.currentStep === "HQ" ? "now" : "todo" },
                ]} />
              )}
              {r.step1 && <div className="text-xs text-gray-500">원장 승인 완료 · {r.step1.name} {shortAt(r.step1.at)}</div>}
              <div className="text-sm">{r.kind === "DEVICE" ? `새 기기: ${r.deviceName ?? "이름 없음"} (${r.platform ?? "-"})` : r.summary}</div>
              {r.timesHidden && r.recordState && <div className="text-xs text-gray-500">그날 기록: {r.recordState}</div>}
              {r.nextStep === "HQ" && isHq === false && <div className="text-xs text-gray-500">승인하면 본부가 시각을 확인해 최종 승인합니다.</div>}
              {(r.kind === "CORRECTION" || r.kind === "MISSED_OUT") && r.reason && <div className="text-sm text-gray-600">사유: {r.reason}</div>}
              {r.memo && <div className="text-sm text-gray-600">메모: {r.memo}</div>}
              <div className="text-xs text-gray-400">
                {requestedAt(r) && <>요청 {requestedAt(r)}</>}
                {r.hasPhoto && <Btn kind="text" className="ml-2 text-[12.5px]" onClick={() => setPhoto(`/api/attendance-requests/${r.id}/photo`)}>사진 보기</Btn>}
              </div>
            </div>
            {/* 줄마다 두 개 — 흰 「반려」 + 인디고 「승인」(시안 R11, ■0-4 「반려」 하나로) */}
            <div className="flex gap-1.5 shrink-0">
              <Btn className="px-3.5 py-1.5" disabled={busy === r.id} onClick={() => { setRejecting(r); setRejectReason(""); }}>반려</Btn>
              <Btn kind="primary" className="px-3.5 py-1.5" disabled={busy === r.id || roleUnknown} onClick={() => onApprove(r)}>{busy === r.id ? "처리 중…" : "승인"}</Btn>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!rejecting} onOpenChange={(o) => { if (!o) setRejecting(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>반려 사유</DialogTitle></DialogHeader>
          <Textarea value={rejectReason} maxLength={300} placeholder="신청자에게 전달됩니다 (선택)" onChange={(e) => setRejectReason(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setRejecting(null)}>닫기</Btn>
            <Btn kind="primary" disabled={!rejecting || busy === rejecting.id} onClick={() => rejecting && decide(rejecting, "reject", rejectReason.trim())}>반려</Btn>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!approving} onOpenChange={(o) => { if (!o) setApproving(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>시각 확인 후 승인</DialogTitle></DialogHeader>
          {approving && (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="font-semibold">{approving.userName}</span>
                <span className="text-gray-500"> · {approving.kindLabel} · {approving.summary}</span>
              </div>
              {approving.step1 && <div className="text-xs text-gray-500">원장 승인 완료 · {approving.step1.name} {shortAt(approving.step1.at)}</div>}
              {approving.reason && <div className="text-sm text-gray-600">사유: {approving.reason}</div>}
              <div className="flex flex-wrap gap-3">
                {approving.kind === "CORRECTION" && (
                  <label className="flex flex-col gap-1 text-[13px] text-gray-600">
                    출근
                    <input type="time" className={inputClass} value={fixIn} onChange={(e) => setFixIn(e.target.value)} />
                  </label>
                )}
                <label className="flex flex-col gap-1 text-[13px] text-gray-600">
                  퇴근
                  <input type="time" className={inputClass} value={fixOut} onChange={(e) => setFixOut(e.target.value)} />
                </label>
              </div>
              <div className="text-xs text-gray-400">직원이 요청한 시각입니다. 고치면 고친 시각으로 기록에 들어갑니다. 퇴근이 출근보다 이르면 다음 날 새벽으로 봅니다.</div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setApproving(null)}>닫기</Btn>
            <Btn kind="primary" disabled={!approving || busy === approving.id || approveBlocked} onClick={sendApprove}>
              {approving && busy === approving.id ? "처리 중…" : "승인"}
            </Btn>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!photo} onOpenChange={(o) => { if (!o) setPhoto(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>지점 사진</DialogTitle></DialogHeader>
          {/* eslint-disable-next-line @next/next/no-img-element -- 인증이 붙은 비공개 사진이라 next/image 최적화를 거치지 않는다 */}
          {photo && <img src={photo} alt="지점 사진" className="w-full rounded" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
