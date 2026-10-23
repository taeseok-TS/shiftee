"use client";

// 인사 › 지점 관리 — 새 모양(2026-10-23 본부 시안 S5)
//  · 카드에 좌표 숫자 · 「지오펜스」 · 「위도/경도」를 쓰지 않는다 → 「출근 인정 거리 100m」. 좌표는 「수정」 창 안에서만.
//  · 빠진 설정(출근 위치 없음 · 원장이 두 분인데 대표원장 없음)은 맨 위 「확인 필요」 분홍 카드로 모은다. 빨강은 그 알약에만, 할 일은 인디고 작은 버튼.
//  · 「통계 포함」 → 「운영 중 / 숨긴 지점」(같은 countInStats). 숨긴 지점(테스트지점)은 다른 화면 지점 고르기 · 인원 숫자에서 빠진다.
//    본부는 지점 수 · 직원 수에서 빼고 목록 맨 아래 따로.
//  · 직원 수 = 인원 숫자 공용 기준의 「지점 직원」(재직 · 휴직 빼고 — /api/employees/headcount).
//  · 화면 이름 「대표원장」(필드는 Branch.mainManagerId 그대로). 대표원장 이름은 지점 목록 응답(mainManager)에서 바로 읽는다 —
//    종전엔 고르기 칸의 값(mainManager.id)이 원장 후보 목록(/api/employees)에 없으면 브라우저가 첫 칸 「지정 안 함」을 보여 줘
//    지정돼 있어도 비어 보였다(대치 · 목동, 10/23 이예지 님). 지금 값은 후보에 없어도 고르기 칸에 넣어 둔다.
import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Navigation, AlertTriangle, List, Map as MapIcon } from "lucide-react";
import { toast } from "sonner";
import { geocodeAddress } from "@/lib/kakao-geocoding";
import { PageHead, Btn, Box, Chip, btnClass } from "@/components/kit";
import { cn } from "@/lib/utils";

type Branch = {
  id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  radius: number;
  countInStats?: boolean; // false = 숨긴 지점(테스트지점) · 본부 — 인원 숫자에서 빠진다
  // 대표원장(화면 이름, 필드는 mainManager) — 한 지점에 원장이 2명일 때 누가 상급인지. 결재 방향을 정한다:
  // 두 번째 원장의 신청은 대표원장이 먼저 결재하고, 대표원장 신청은 관리자에게 바로 간다.
  mainManagerId?: string | null;
  mainManager?: { id: string; name: string } | null;
  _count?: { users: number };
};

// ⚠ `/api/employees` 는 겸직 지점을 **문자열 배열**로 준다(`managerBranches: string[]`).
//   객체 배열로 잘못 선언했다가 겸직이 한 번도 매칭되지 않았다 — 타입이 거짓이라
//   tsc 가 못 잡았고, 분당서현.분당야탑에는 메인 원장 선택이 아예 안 떴다
//   (2026-09-09 검증에서 API 실응답으로 적발).
type BranchManager = { id: string; name: string; branch: string | null; managerBranches?: string[] };
type HeadBranch = { branch: string; staff: number; onLeave: number; total: number };
type Headcount = { staff: number; onLeave: number; total: number; byBranch: HeadBranch[] };

const HQ_BRANCH = "본부";
const EMPTY_FORM = { name: "", address: "", latitude: "", longitude: "", radius: "100", mainManagerId: "", hidden: false };

/** 좌표 입력 확인 — 둘 다 비었으면 null(좌표 없음), 숫자 둘이면 값, 그 밖엔 오류 문구 */
function coordsOf(f: { latitude: string; longitude: string }): { latitude: number | null; longitude: number | null } | string {
  const la = f.latitude.trim(), lo = f.longitude.trim();
  if (la === "" && lo === "") return { latitude: null, longitude: null };
  if (la === "" || lo === "") return "출근 위치의 두 숫자(위도 · 경도)를 둘 다 넣어 주세요.";
  const a = Number(la), b = Number(lo);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "출근 위치는 숫자로 넣어 주세요. (예: 37.4979, 127.0276)";
  return { latitude: a, longitude: b };
}

// 0,0 은 옛 버그로 저장된 값이라 「설정됨」으로 세지 않는다 — 수정 창에서 실제 위치를 넣어야 한다(2026-10-06)
const geoOk = (b: Branch) => b.latitude != null && b.longitude != null && b.latitude !== 0 && b.longitude !== 0; // 한쪽만 0 이어도 미설정(서버 판정과 같게)
const isHQ = (b: Branch) => b.name === HQ_BRANCH;
const isHidden = (b: Branch) => b.countInStats === false && !isHQ(b);

/* 카드 안 작은 알약(시안 S5 .k) — 기본 회색 면 · 대표원장 연인디고 · 빠진 설정 연분홍 */
function K({ tone = "gray", children }: { tone?: "gray" | "ind" | "red"; children: React.ReactNode }) {
  return <span className={cn("rounded-full px-2.5 py-[3px] text-[12.5px] font-semibold",
    tone === "ind" ? "bg-[#eef2ff] text-[#3730a3]" : tone === "red" ? "bg-[#fff1f2] text-[#be123c]" : "bg-[#f1f5f9] text-[#334155]")}>{children}</span>;
}

export default function BranchesPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  // 대표원장 후보 — 활성 원장 전원(대표.겸직 지점 정보 포함)
  const [managers, setManagers] = useState<BranchManager[]>([]);
  const [headcount, setHeadcount] = useState<Headcount | null>(null);
  const [myRole, setMyRole]     = useState<string | null>(null);  // null = 로딩 중
  const [view, setView]         = useState<"open" | "hidden">("open");

  const [addOpen, setAddOpen]   = useState(false);
  const [form, setForm]         = useState({ ...EMPTY_FORM });

  const [editOpen, setEditOpen]     = useState(false);
  const [editTarget, setEditTarget] = useState<Branch | null>(null);
  const [editForm, setEditForm]     = useState({ ...EMPTY_FORM });

  const [deleteOpen, setDeleteOpen]     = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);

  const isAdmin = myRole === "ADMIN";
  const canAccess = myRole === "ADMIN" || myRole === "MANAGER";

  const fetchBranches = useCallback(async () => {
    const data = await fetch("/api/branches", { credentials: "include" }).then(r => r.json());
    setBranches(data.branches || []);
    // 직원 수(지점 직원 — 재직 · 휴직 빼고)는 인원 숫자 공용 기준에서
    fetch("/api/employees/headcount", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then((d) => { if (d) setHeadcount(d); }).catch(() => {});
  }, []);

  // 대표원장 후보 — 활성 원장만. 관리자만 이 목록이 필요하다(원장은 보기만 — 원장 이름도 함께 보여 주려고 원장에게도 받는다)
  const fetchManagers = useCallback(async () => {
    if (myRole !== "ADMIN" && myRole !== "MANAGER") return;
    try {
      const d = await fetch("/api/employees", { credentials: "include" }).then(r => r.json());
      setManagers((d.employees || []).filter((e: { role?: string }) => e.role === "MANAGER"));
    } catch { /* 목록을 못 읽어도 지점 관리 자체는 되게 둔다 */ }
  }, [myRole]);
  useEffect(() => { fetchManagers(); }, [fetchManagers]);

  /** 그 지점을 담당하는 활성 원장들 (대표 지점 + 겸직) */
  const managersOf = useCallback((branchName: string) =>
    managers.filter((m) =>
      m.branch === branchName || (m.managerBranches ?? []).includes(branchName)
    ), [managers]);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" }).then(r => r.json()).then(d => setMyRole(d.user?.role || "EMPLOYEE"));
    fetchBranches();
  }, [fetchBranches]);

  const staffOf = useMemo(() => new Map((headcount?.byBranch ?? []).map((h) => [h.branch, h])), [headcount]);

  /* ── 내 위치로 좌표 채우기 ── */
  function fillMyLocation(target: "add" | "edit") {
    if (!navigator.geolocation) { toast.error("이 브라우저는 위치를 지원하지 않습니다."); return; }

    // HTTPS 또는 localhost 환경 확인
    const isSecure = window.location.protocol === "https:" || window.location.hostname === "localhost";
    if (!isSecure) {
      toast.error("HTTPS 연결에서만 위치 기능을 사용할 수 있습니다.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude.toFixed(7);
        const lon = pos.coords.longitude.toFixed(7);
        if (target === "add") setForm(f => ({ ...f, latitude: lat, longitude: lon }));
        else                  setEditForm(f => ({ ...f, latitude: lat, longitude: lon }));
        toast.success("지금 있는 곳을 출근 위치로 넣었습니다.");
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          toast.error("위치 권한이 거부되었습니다.");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          toast.error("위치 정보를 얻을 수 없습니다.");
        } else {
          toast.error("위치를 불러올 수 없습니다.");
        }
      }
    );
  }

  /* ── 주소로부터 좌표 검색 (Kakao Geocoding) ── */
  async function fillLocationFromAddress(target: "add" | "edit") {
    const address = target === "add" ? form.address : editForm.address;

    if (!address.trim()) {
      toast.error("주소를 입력해주세요.");
      return;
    }

    try {
      toast.loading("주소를 검색 중입니다...");
      const result = await geocodeAddress(address);

      const lat = result.latitude.toFixed(7);
      const lon = result.longitude.toFixed(7);

      if (target === "add") {
        setForm(f => ({ ...f, latitude: lat, longitude: lon }));
      } else {
        setEditForm(f => ({ ...f, latitude: lat, longitude: lon }));
      }

      toast.success(`주소 위치를 찾았습니다.\n${result.fullAddress}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "주소 검색에 실패했습니다.";
      toast.error(errorMsg);
    }
  }

  /* ── 추가 ── */
  async function handleAdd(ev: React.FormEvent) {
    ev.preventDefault();
    const co = coordsOf(form);
    if (typeof co === "string") { toast.error(co); return; }
    const res  = await fetch("/api/branches", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        address: form.address || null,
        latitude:  co.latitude,
        longitude: co.longitude,
        radius: Number(form.radius) || 100,
      }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("지점이 등록되었습니다.");
    setAddOpen(false); setForm({ ...EMPTY_FORM }); fetchBranches();
  }

  /* ── 수정 열기 ── */
  function openEdit(b: Branch) {
    setEditTarget(b);
    setEditForm({
      name:      b.name,
      address:   b.address   ?? "",
      latitude:  b.latitude  != null ? String(b.latitude)  : "",
      longitude: b.longitude != null ? String(b.longitude) : "",
      radius:    String(b.radius),
      mainManagerId: b.mainManager?.id ?? b.mainManagerId ?? "",
      hidden: b.countInStats === false,
    });
    setEditOpen(true);
  }

  /* ── 수정 저장 — 위치 · 출근 인정 거리 · 대표원장 · 숨긴 지점을 한 번에 ── */
  async function handleEdit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!editTarget) return;
    const co = coordsOf(editForm);
    if (typeof co === "string") { toast.error(co); return; }
    // 대표원장은 바꿨을 때만 보낸다 — 그대로면 보내지 않아 서버가 손대지 않는다(후보 목록에 없는 원장이 지워지지 않게)
    const origMain = editTarget.mainManager?.id ?? editTarget.mainManagerId ?? "";
    const mainChanged = mainChoicesOf(editTarget).length > 0 && editForm.mainManagerId !== origMain;
    const res = await fetch(`/api/branches/${editTarget.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:      editForm.name,
        address:   editForm.address || null,
        latitude:  co.latitude,
        longitude: co.longitude,
        radius:    Number(editForm.radius) || 100,
        countInStats: !editForm.hidden,
        ...(mainChanged ? { mainManagerId: editForm.mainManagerId || null } : {}),
      }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("지점 정보가 수정되었습니다.");
    setEditOpen(false); fetchBranches();
  }

  /* ── 삭제 ── */
  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/branches/${deleteTarget.id}`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("지점이 삭제되었습니다.");
    setDeleteOpen(false); setDeleteTarget(null); setEditOpen(false); fetchBranches();
  }

  /** 대표원장 고르기 칸에 넣을 사람 — 그 지점 원장 + 지금 지정된 사람(후보 목록에 없어도 — 값이 「지정 안 함」으로 보이지 않게) */
  function mainChoicesOf(b: Branch): { id: string; name: string }[] {
    const list = managersOf(b.name).map((m) => ({ id: m.id, name: m.name }));
    const cur = b.mainManager;
    if (cur && !list.some((m) => m.id === cur.id)) list.unshift({ id: cur.id, name: cur.name });
    return list.length > 1 || cur ? list : [];
  }

  if (myRole === null) {
    return <div className="text-center text-gray-400 py-32">불러오는 중…</div>;
  }

  if (!canAccess) {
    return <div className="text-center text-gray-400 py-32">접근 권한이 없습니다.</div>;
  }

  const open = branches.filter((b) => !isHidden(b) && !isHQ(b));
  const hidden = branches.filter(isHidden);
  const hq = branches.filter(isHQ);
  // 확인 필요 — 운영 중 지점만(숨긴 지점 · 본부는 빼고): 출근 위치 없음 · 원장이 두 분 이상인데 대표원장 없음
  const needsMain = (b: Branch) => managersOf(b.name).length > 1 && !b.mainManager;
  const issues = isAdmin ? open.filter((b) => !geoOk(b) || needsMain(b)) : [];
  const shown = view === "hidden" ? hidden : open;
  const staffTotal = headcount?.staff, onLeaveTotal = headcount?.onLeave;

  /** 원장 이름 알약 — 대표원장은 인디고 따로, 나머지 「원장 김○○ · 이○○」, 겸직은 「겸직 조○○」 */
  const managerPills = (b: Branch) => {
    const ms = managersOf(b.name);
    const main = b.mainManager;
    const rest = ms.filter((m) => m.id !== main?.id);
    const own = rest.filter((m) => m.branch === b.name).map((m) => m.name);
    const extra = rest.filter((m) => m.branch !== b.name).map((m) => m.name);
    const restLabel = [own.length ? `원장 ${own.join(" · ")}` : "", extra.length ? `겸직 ${extra.join(" · ")}` : ""].filter(Boolean).join(" · ");
    return (
      <>
        {main && <K tone="ind">대표원장 {main.name}</K>}
        {restLabel && <K>{restLabel}</K>}
      </>
    );
  };

  const card = (b: Branch, warn = false) => {
    const hc = staffOf.get(b.name);
    // 숨긴 지점 · 본부는 인원 숫자에서 빠진다 — 「직원 0명」으로 보이지 않게 「인원 세지 않음」, 인원을 아직 못 받았으면 「…」
    const countText = isHidden(b) || isHQ(b) ? "인원 세지 않음" : !headcount ? "직원 …" : `직원 ${hc ? hc.staff : 0}명`;
    return (
      <div key={b.id} className={cn("flex flex-col gap-2 rounded-[14px] border bg-white px-4 py-[15px]", warn ? "border-[#fecdd3] bg-[#fffafa]" : "border-[#e6eaf0]")}>
        <div className="flex items-center gap-2">
          <b className="min-w-0 truncate text-[17px] text-[#0f172a]">{b.name}</b>
          <span className="ml-auto shrink-0 text-[13.5px] text-[#596578]">{countText}</span>
          {isAdmin && !warn && (
            <button type="button" onClick={() => openEdit(b)} className="-my-2 -mr-2 min-h-11 shrink-0 px-2 text-[13.5px] font-semibold text-[#4f46e5] hover:underline">수정</button>
          )}
        </div>
        <p className="text-[13.5px] text-[#475569]">{b.address || "주소 없음"}</p>
        {warn && (
          <p className="text-[13.5px] text-[#334155]">
            {!geoOk(b) ? "앱 출근 때 위치를 확인하지 못함" : "원장 근무일정을 누가 1차로 결재할지 정해지지 않음"}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {!warn && managerPills(b)}
          {warn && !geoOk(b) && <K tone="red">출근 위치 없음</K>}
          {warn && needsMain(b) && <K tone="red">대표원장 없음</K>}
          {!warn && (geoOk(b) ? <K>출근 인정 거리 {b.radius}m</K> : <K tone="red">출근 위치 없음</K>)}
          {!warn && isHidden(b) && <K>숨긴 지점</K>}
        </div>
        {warn && isAdmin && (
          <div className="mt-0.5 flex items-center gap-3 border-t border-[#f1f5f9] pt-2.5">
            <button type="button" onClick={() => openEdit(b)} className={btnClass("primary", "min-h-11 sm:min-h-0 sm:h-8 !px-3.5 !text-[13px]")}>
              {!geoOk(b) ? "출근 위치 정하기" : "대표원장 정하기"}
            </button>
            <button type="button" onClick={() => openEdit(b)} className="ml-auto min-h-11 px-1 text-[13.5px] font-semibold text-[#64748b] hover:underline">수정</button>
          </div>
        )}
      </div>
    );
  };

  const editChoices = editTarget ? mainChoicesOf(editTarget) : [];

  return (
    <div>
      <PageHead crumb="인사 › 지점 관리" title="지점 관리">
        {isAdmin && <Btn kind="primary" onClick={() => setAddOpen(true)}>지점 추가</Btn>}
      </PageHead>

      {/* 확인 필요 — 빠진 설정이 있을 때만 */}
      {issues.length > 0 && (
        <Box icon={<AlertTriangle />} tone="rose" title="확인 필요" count={issues.length} sub="출근 위치 · 대표원장이 정해지지 않은 지점">
          <div className="grid gap-3.5 px-6 pb-[22px] pt-[18px] md:grid-cols-2 xl:grid-cols-3">
            {issues.map((b) => card(b, true))}
          </div>
        </Box>
      )}

      <Box icon={<List />} tone="sky" title="전체 지점"
        sub={`운영 ${open.length}곳${typeof staffTotal === "number" ? ` · 지점 직원 ${staffTotal}명(휴직 ${onLeaveTotal ?? 0}명 빼고)` : ""}`}
        right={
          <div className="flex flex-wrap gap-1.5">
            <Chip on={view === "open"} onClick={() => setView("open")}>운영 중</Chip>
            <Chip on={view === "hidden"} onClick={() => setView("hidden")}>숨긴 지점 {hidden.length}</Chip>
          </div>
        }>
        {view === "hidden" && (
          <p className="px-6 pt-4 text-[13px] text-[#596578]">숨긴 지점은 다른 화면의 지점 고르기 · 인원 숫자에 나오지 않습니다. 「수정」에서 다시 운영 중으로 바꿀 수 있습니다.</p>
        )}
        {shown.length > 0 ? (
          <div className="grid gap-3.5 px-6 pb-[22px] pt-[18px] md:grid-cols-2 xl:grid-cols-3">
            {shown.map((b) => card(b))}
          </div>
        ) : (
          <div className="px-6 py-10 text-center text-[14px] text-[#596578]">
            {view === "hidden" ? "숨긴 지점이 없습니다." : "등록된 지점이 없습니다."}
            {isAdmin && view === "open" && <div className="mt-3"><Btn kind="primary" onClick={() => setAddOpen(true)}>지점 추가</Btn></div>}
          </div>
        )}
        {/* 본부 — 지점 수 · 직원 수에서 빼고 맨 아래 따로 */}
        {view === "open" && hq.length > 0 && (
          <div className="border-t border-[#eef1f5] px-6 pb-[22px] pt-4">
            <p className="mb-2 text-[13px] font-semibold text-[#596578]">본부 — 지점 수 · 직원 수에 넣지 않음</p>
            <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">{hq.map((b) => card(b))}</div>
          </div>
        )}
      </Box>

      {/* ═══ 지점 추가 다이얼로그 ═══ */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>지점 추가</DialogTitle></DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="space-y-1.5">
              <Label>지점 이름 *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="예: 대치" required />
            </div>
            <div className="space-y-1.5">
              <Label>주소</Label>
              <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))}
                placeholder="예: 서울시 강남구 테헤란로 123" />
            </div>
            <LocationFields f={form} set={(p) => setForm((f) => ({ ...f, ...p }))} onAddress={() => fillLocationFromAddress("add")} onHere={() => fillMyLocation("add")} />
            <div className="flex gap-2 justify-end pt-1">
              <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>취소</Button>
              <Button type="submit" className="bg-[#4f46e5] text-white hover:bg-[#4338ca]">등록</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ 지점 수정 다이얼로그 — 위치 · 출근 인정 거리 · 대표원장 · 숨긴 지점 · 삭제 ═══ */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md max-h-[90dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>지점 수정 — {editTarget?.name}</DialogTitle></DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>지점 이름 *</Label>
              <Input value={editForm.name}
                onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="space-y-1.5">
              <Label>주소</Label>
              <Input value={editForm.address}
                onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))}
                placeholder="예: 서울시 강남구 테헤란로 123" />
            </div>
            <LocationFields f={editForm} set={(p) => setEditForm((f) => ({ ...f, ...p }))} onAddress={() => fillLocationFromAddress("edit")} onHere={() => fillMyLocation("edit")} />

            {/* 대표원장 — 원장이 두 분 이상인 지점(또는 이미 지정된 지점)에서만 */}
            {editChoices.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="main-manager">대표원장</Label>
                <select id="main-manager" value={editForm.mainManagerId} onChange={(e) => setEditForm((f) => ({ ...f, mainManagerId: e.target.value }))}
                  className="h-11 w-full rounded-md border border-input bg-white px-3 text-sm">
                  <option value="">정하지 않음</option>
                  {editChoices.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
                <p className="text-xs text-gray-500">다른 원장의 근무일정 · 휴가 신청을 대표원장이 먼저 결재합니다. 대표원장 본인 신청은 본부로 바로 갑니다.</p>
              </div>
            )}

            <label className="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#4f46e5]" checked={editForm.hidden} onChange={(e) => setEditForm((f) => ({ ...f, hidden: e.target.checked }))} />
              <span>
                <b className="font-semibold text-[#0f172a]">숨긴 지점으로 두기</b>
                <span className="block text-xs text-gray-500">테스트지점처럼 실제로 운영하지 않는 지점 — 인원 숫자 · 다른 화면의 지점 고르기에서 빠집니다.{editTarget && isHQ(editTarget) ? " 본부는 지점 고르기에는 남습니다." : ""}</span>
              </span>
            </label>

            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={() => { if (editTarget) { setDeleteTarget(editTarget); setDeleteOpen(true); } }}
                className="min-h-11 px-1 text-sm font-semibold text-[#dc2626] hover:underline">지점 삭제</button>
              <div className="ml-auto flex gap-2">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>취소</Button>
                <Button type="submit" className="bg-[#4f46e5] text-white hover:bg-[#4338ca]">저장</Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ═══ 지점 삭제 확인 다이얼로그 ═══ */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>지점 삭제</AlertDialogTitle>
            <AlertDialogDescription>
              &apos;{deleteTarget?.name}&apos; 지점을 정말로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="flex gap-2 justify-end">
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              삭제
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** 출근 위치 · 출근 인정 거리 칸(추가 · 수정 창 공용) — 화면 말은 「출근 위치」, 숫자 두 칸은 이 창 안에서만 */
function LocationFields({ f, set, onAddress, onHere }: {
  f: { latitude: string; longitude: string; radius: string };
  set: (p: Partial<{ latitude: string; longitude: string; radius: string }>) => void;
  onAddress: () => void; onHere: () => void;
}) {
  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <Label>출근 위치</Label>
          <div className="flex gap-1">
            <Button type="button" variant="ghost" size="sm" className="h-9 text-xs gap-1" onClick={onAddress}>
              <MapIcon size={12} />주소로 찾기
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-9 text-xs gap-1" onClick={onHere}>
              <Navigation size={12} />지금 있는 곳
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input value={f.latitude} onChange={e => set({ latitude: e.target.value })} placeholder="위도  예: 37.5665" aria-label="출근 위치 위도" />
          <Input value={f.longitude} onChange={e => set({ longitude: e.target.value })} placeholder="경도  예: 126.9780" aria-label="출근 위치 경도" />
        </div>
        <p className="text-xs text-gray-500">
          「주소로 찾기」나 「지금 있는 곳」으로 채우거나, 카카오맵 · 구글맵에서 지점을 오른쪽 클릭해 나오는 두 숫자를 넣습니다. 비워 두면 앱 출근 때 위치를 확인하지 않습니다.
        </p>
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>출근 인정 거리</Label>
          <span className="text-sm font-semibold text-[#4f46e5]">{f.radius}m</span>
        </div>
        <input type="range" min="50" max="300" step="10" value={f.radius} onChange={e => set({ radius: e.target.value })}
          aria-label="출근 인정 거리" className="w-full accent-[#4f46e5]" />
        <div className="flex justify-between text-xs text-gray-500">
          <span>50m</span><span>100m</span><span>200m</span><span>300m</span>
        </div>
      </div>
    </>
  );
}
