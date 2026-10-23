"use client";

import { useWeekHours } from "@/components/schedule/WeekHours";
import { useRangeLeaves } from "@/components/schedule/WeekExtras";
import { MultiPick } from "@/components/schedule/ScheduleControls";
import { ScheduleEditDialog, ScheduleBulkDialog, type EditTarget } from "@/components/schedule/ScheduleDialogs";
import { ScheduleBoard, ScheduleLegend, ScheduleViewBar, useScheduleView, type BoardEmployee, type BoardSchedule } from "@/components/schedule/ScheduleBoard";
import SchedulePhoneWeek, { mondayOf, plusDays, useIsPhone } from "@/components/schedule/SchedulePhoneWeek";
import { kstNow } from "@/components/attendance/board-state";
import { sortEmployees, yearsOf } from "@/lib/schedule-view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHead, Box, Btn, FilterRow, inputClass } from "@/components/kit";
import { Search, Plus, CalendarRange, CalendarDays } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Employee = BoardEmployee;
type Schedule = BoardSchedule;

export default function ManagerSchedulePage() {
  const [branch, setBranch] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  // 보기 전환(#71): 일·주·월 × 달력형·목록형, 정렬·표시·주 시작 요일(#73) — 사람마다 저장
  const view = useScheduleView();
  const [searchName, setSearchName] = useState("");
  // 필터(#72): 직무·지점(겸직 원장) 여러 개 동시 선택(빈 배열 = 전체)
  const [selJobGroups, setSelJobGroups] = useState<string[]>([]);
  const [selBranches, setSelBranches] = useState<string[]>([]);
  // 일정 관리(2026-10-07 QA #18 #12) — 칸을 누르면 추가, 일정을 누르면 고치기·지우기
  const [edit, setEdit] = useState<EditTarget>(null);
  const [canEdit, setCanEdit] = useState(true);   // 「원장 근무일정 직접 편집」 권한(#39) — 꺼지면 버튼·칸 편집을 숨긴다(실제 차단은 API)
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkKey, setBulkKey] = useState(0);   // 열 때마다 새 창(이전 선택이 남지 않게)
  const [me, setMe] = useState<{ id: string; name: string; branch: string | null } | null>(null);

  // 지점 정보
  useEffect(() => {
    let alive = true;
    fetch("/api/me/permissions").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d?.permissions) setCanEdit(d.permissions["manager.editSchedule"] !== false); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => {
        setBranch(d.user?.branch || d.branch || "");
        if (d.user?.id) setMe({ id: d.user.id, name: d.user.name, branch: d.user.branch ?? null });
      })
      .catch(() => {});
  }, []);

  // 팀 직원 (API가 MANAGER 세션 기준 자기 지점만 반환)
  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch {
      toast.error("직원 목록을 불러올 수 없습니다");
    }
  }, []);

  // 주 근로시간 — 49시간을 넘으면 빨간 표시(#38, 담당 지점만). 일정을 저장하면 다시 센다. 주 보기에서만
  const [weekReload, setWeekReload] = useState(0);
  const weekHours = useWeekHours(view.weekMonday, weekReload);

  // 휴가(승인 · 결재 대기)와 결재 대기 근무 변경 — 휴가인 날은 근무 대신 휴가만 보인다(■0-5)
  const leaves = useRangeLeaves(view.startYmd, view.endYmd, true, weekReload);

  // 공휴일 — 날짜별 이름 맵(본부 근무일정과 같은 표시). 기간이 두 해에 걸치면 둘 다
  const [holidayMap, setHolidayMap] = useState<Map<string, string>>(new Map());
  // 폰 「이번 주」(KST 오늘 ± 6일)가 보기 기간과 다른 해일 수 있어 그 해도 함께 받는다(10/24 검증 P3)
  const kstYear = (dayOffset: number) => String(new Date(Date.now() + 9 * 3600 * 1000 + dayOffset * 86400000).getUTCFullYear());
  const yearsKey = [...new Set([...yearsOf(view.range).map(String), kstYear(-6), kstYear(6)])].sort().join(",");
  useEffect(() => {
    let alive = true;
    Promise.all(yearsKey.split(",").map((y) => fetch(`/api/holidays?year=${y}`).then((r) => (r.ok ? r.json() : { holidays: [] })).catch(() => ({ holidays: [] }))))
      .then((list) => { if (alive) setHolidayMap(new Map(list.flatMap((d) => (d.holidays || []) as { date: string; name: string }[]).map((h) => [h.date, h.name]))); });
    return () => { alive = false; };
  }, [yearsKey]);

  // 근무 일정 (보기 기간 기준)
  const { startYmd, endYmd } = view;
  // 기간이 바뀐 뒤 늦게 도착한 옛 기간 응답은 버린다 — 저장된 보기가 월이면 첫 화면에서 주→월 순으로 두 번 조회된다(#71 검증 1)
  const reqKey = useRef("");
  const fetchSchedules = useCallback(async () => {
    const key = `${startYmd}~${endYmd}`;
    reqKey.current = key;
    try {
      setLoading(true);
      const res = await fetch(`/api/schedule?start=${startYmd}&end=${endYmd}`);
      if (reqKey.current !== key) return;
      if (res.ok) {
        const data = await res.json();
        if (reqKey.current !== key) return;
        setSchedules(data.schedules || []);
      }
    } catch {
      if (reqKey.current === key) toast.error("근무 일정을 불러올 수 없습니다");
    } finally {
      if (reqKey.current === key) setLoading(false);
    }
  }, [startYmd, endYmd]);

  useEffect(() => {
    // 효과 안에서 바로 setState 하지 않게 한 박자 뒤에(react-hooks/set-state-in-effect)
    Promise.resolve().then(() => { fetchEmployees(); fetchSchedules(); });
  }, [fetchEmployees, fetchSchedules]);

  // 원장 본인 일정도 여기서 넣는다(본부 답변 #7) — 직원 목록에 본인이 없으면 맨 앞에 붙인다
  const team = useMemo(() => {
    if (!me || employees.some((e) => e.id === me.id)) return employees;
    return [{ id: me.id, name: `${me.name} (본인)`, position: null, jobGroup: "원장", branch: me.branch }, ...employees];
  }, [employees, me]);
  const jobGroups = useMemo(() => [...new Set(team.map((e) => e.jobGroup || e.position).filter((v): v is string => !!v))].sort(), [team]);
  const branches = useMemo(() => [...new Set(team.map((e) => e.branch).filter((v): v is string => !!v))].sort(), [team]);
  const q = searchName.trim();
  const sortKey = view.prefs.sort;
  const filteredEmployees = useMemo(() => {
    const fj = selJobGroups.filter((v) => jobGroups.includes(v)), fb = selBranches.filter((v) => branches.includes(v));   // 목록에 있는 값만(10/12 검증 4)
    const list = team.filter(emp => {
      if (fj.length && !fj.includes(emp.jobGroup || emp.position || "")) return false;
      if (fb.length && !(emp.branch && fb.includes(emp.branch))) return false;
      return !q || emp.name.includes(q);
    });
    // 정렬(#73) — 본인 행은 정렬과 무관하게 맨 앞(본부 답변 #7 의 「맨 앞에 붙인다」 유지)
    const sorted = sortEmployees(list, sortKey);
    const mine = me ? sorted.filter((e) => e.id === me.id) : [];
    return mine.length ? [...mine, ...sorted.filter((e) => e.id !== me!.id)] : sorted;
  }, [team, jobGroups, branches, selJobGroups, selBranches, q, sortKey, me]);

  const onSaved = () => { fetchSchedules(); setWeekReload((n) => n + 1); };

  // 칸 · 줄을 눌렀을 때 — 띠 표(PC)와 폰 목록이 같은 창을 연다(편집 권한이 꺼지면 보기만)
  const onEmptyCell = canEdit ? (userId: string, date: string) => setEdit({ userId, date, startTime: "10:00", endTime: "19:00" }) : undefined;
  const onSchedule = canEdit ? (s: Schedule, emp: Employee) => setEdit({ id: s.id, userId: emp.id, date: s.date, startTime: s.startTime, endTime: s.endTime, type: s.type, note: s.note ?? null }) : undefined;

  // 폰(md 미만) 첫 화면 — 오늘 · 이번 주 목록(■2 · ■4). 띠 표는 「표 보기」를 눌렀을 때만
  const [tableOpen, setTableOpen] = useState(false);
  const phone = useIsPhone();
  const [today] = useState(() => kstNow().today);
  const weekMon = mondayOf(today), weekSun = plusDays(weekMon, 6);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => plusDays(weekMon, i)), [weekMon]);
  // 보기 기간이 이번 주(월~일)를 다 덮으면 받은 것을 그대로 쓰고, 아니면(하루 보기 · 다른 달 등) 폰에서만 이번 주치를 따로 받는다
  const covered = startYmd <= weekMon && endYmd >= weekSun;
  const needWeek = phone && !covered;
  const weekLeaves = useRangeLeaves(weekMon, weekSun, needWeek, weekReload);
  const [weekSchedules, setWeekSchedules] = useState<{ key: string; list: Schedule[] } | null>(null);
  useEffect(() => {
    if (!needWeek) return;
    let alive = true;
    const key = `${weekMon}~${weekSun}`;
    fetch(`/api/schedule?start=${weekMon}&end=${weekSun}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setWeekSchedules({ key, list: d.schedules || [] }); })
      .catch(() => {});
    return () => { alive = false; };
  }, [needWeek, weekMon, weekSun, weekReload]);
  const weekReady = covered ? !loading : weekSchedules?.key === `${weekMon}~${weekSun}`;

  return (
    <div>
      {/* 머리(R10 톤) — 제목 = 메뉴 이름 + 위 작은 경로. 흰 「일정 추가」 + 인디고 실행 「여러 날 한 번에 넣기」 하나.
          제목은 폰에서 「지점 근무일 / 정」으로 꺾이지 않게 한 덩어리(■2) */}
      <PageHead crumb="근태 › 지점 근무일정" title={<span className="whitespace-nowrap">지점 근무일정</span>} note={branch || undefined}>
        {canEdit && <>
          <Btn onClick={() => setEdit({ userId: "", date: format(new Date(), "yyyy-MM-dd"), startTime: "10:00", endTime: "19:00" })}>
            <Plus size={15} />일정 추가
          </Btn>
          <Btn kind="primary" onClick={() => { setBulkKey((k) => k + 1); setBulkOpen(true); }}>
            <CalendarRange size={15} />여러 날 한 번에 넣기
          </Btn>
        </>}
      </PageHead>
      {!canEdit && (
        <p className="mb-[18px] rounded-[10px] border border-[#e2e8f0] bg-white px-4 py-2.5 text-[13px] text-[#596578]">
          본부가 원장의 근무일정 직접 편집을 꺼 두었습니다 — 바꿀 때는 「근무 변경 요청」으로 해 주세요.
        </p>
      )}

      {/* 폰 첫 화면 — 오늘 · 이번 주 목록(■2 · ■4). 데이터는 위에서 받은 것 그대로, 누르면 아래 띠 표와 같은 창 */}
      <SchedulePhoneWeek today={today} days={weekDays} employees={filteredEmployees}
        schedules={covered ? schedules : weekSchedules?.list ?? []} leaves={covered ? leaves : weekLeaves} holidayMap={holidayMap}
        loading={!weekReady} tableOpen={tableOpen} onToggleTable={() => setTableOpen((v) => !v)}
        onEmptyCell={onEmptyCell} onSchedule={onSchedule} />

      {/* 일정 표 박스 — 위: 날짜 이동 + 보기 전환(#71), 필터 줄(#72), 아래: 일·주·월 / 달력형·목록형 표. 폰에서는 「표 보기」를 눌렀을 때만 */}
      <Box icon={<CalendarDays />} tone="ind" title="직원별 근무일정" className={tableOpen ? "" : "hidden md:block"}
        sub={canEdit ? "지점 직원 · 본인 · 칸을 누르면 추가, 일정을 누르면 고치기" : "지점 직원 · 본인"}
        right={<span className="text-[13px] font-normal text-[#596578]">{filteredEmployees.length}명 / 전체 {team.length}명</span>}>
        <div className="border-b border-[#eef1f5] px-6 py-4">
          {/* 주 근무시간 숫자는 본부만(■0-11) — 합계 열 고르기도 뺀다 */}
          <ScheduleViewBar view={view} hideShow={["total"]} />
        </div>
        {/* 필터(#72) — 직무 여러 개, 겸직이면 지점도, 이름 검색 */}
        <FilterRow>
          <MultiPick label="직무" options={jobGroups} value={selJobGroups} onChange={setSelJobGroups} allLabel="모든 직무" />
          {branches.length > 1 && <MultiPick label="지점" options={branches} value={selBranches} onChange={setSelBranches} allLabel="모든 지점" />}
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" />
            <input placeholder="직원 이름 검색" aria-label="직원 이름 검색" value={searchName} onChange={(e) => setSearchName(e.target.value)} className={`${inputClass} w-48 pl-8`} />
          </div>
          {(selJobGroups.length || selBranches.length || searchName) ? (
            <Btn kind="text" className="text-[13px]" onClick={() => { setSelJobGroups([]); setSelBranches([]); setSearchName(""); }}>필터 지우기</Btn>
          ) : null}
        </FilterRow>
        <ScheduleLegend className="border-b border-[#eef1f5] bg-[#fcfdff] px-6 py-2.5" />
        {/* 일정 표 — 칸을 누르면 추가, 일정을 누르면 고치기(편집 권한이 꺼지면 보기만) */}
        <div className="overflow-x-auto">
          <ScheduleBoard view={view} employees={filteredEmployees} schedules={schedules} loading={loading}
            holidayMap={holidayMap} leaves={leaves} weekHours={weekHours} hoursHidden
            onEmptyCell={onEmptyCell} onSchedule={onSchedule} />
        </div>
        <p className="border-t border-[#eef1f5] px-6 py-3 text-[12.5px] text-[#596578]">
          직원이 올린 근무 변경 · 휴가는 결재 대기 동안 점선으로 보이고, 승인되면 면으로 바뀝니다. 원장이 여기서 넣은 일정(주말 포함)은 바로 확정됩니다. 기본 근무 = 그 직원이 이 기간 평일에 가장 많이 한 시간.
        </p>
      </Box>

      <ScheduleEditDialog key={edit ? `${edit.id ?? "new"}-${edit.userId}-${edit.date}` : "none"} target={edit} employees={team.map((e) => ({ id: e.id, name: e.name, branch: e.branch }))}
        onClose={() => setEdit(null)} onSaved={onSaved} />
      <ScheduleBulkDialog key={bulkKey} open={bulkOpen} employees={team.map((e) => ({ id: e.id, name: e.name, branch: e.branch }))}
        onClose={() => setBulkOpen(false)} onSaved={onSaved} />
    </div>
  );
}
