"use client";

import { useWeekHours } from "@/components/schedule/WeekHours";
import { useRangeLeaves, useBranchColors } from "@/components/schedule/WeekExtras";
import { MultiPick } from "@/components/schedule/ScheduleControls";
import { ScheduleEditDialog, ScheduleBulkDialog, type EditTarget } from "@/components/schedule/ScheduleDialogs";
import { ScheduleBoard, ScheduleViewBar, useScheduleView, type BoardEmployee, type BoardSchedule } from "@/components/schedule/ScheduleBoard";
import { sortEmployees, yearsOf } from "@/lib/schedule-view";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, Plus, CalendarRange } from "lucide-react";
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
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkKey, setBulkKey] = useState(0);   // 열 때마다 새 창(이전 선택이 남지 않게)
  const [me, setMe] = useState<{ id: string; name: string; branch: string | null } | null>(null);

  // 지점 정보
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

  // 휴가 함께 보기(#61, 보기 설정 「승인된 휴가」)·지점 색(#74)
  const leaves = useRangeLeaves(view.startYmd, view.endYmd, view.show.leave, weekReload);
  const branchColor = useBranchColors();

  // 공휴일 — 날짜별 이름 맵(본부 근무일정과 같은 표시). 기간이 두 해에 걸치면 둘 다
  const [holidayMap, setHolidayMap] = useState<Map<string, string>>(new Map());
  const yearsKey = yearsOf(view.range).join(",");
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
    fetchEmployees();
    fetchSchedules();
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

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">팀 근무일정</h1>
          <p className="text-gray-600 mt-1">{branch} - 팀원·본인 근무일정 관리 (칸을 누르면 추가, 일정을 누르면 고치기)</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="gap-1" onClick={() => setEdit({ userId: "", date: format(new Date(), "yyyy-MM-dd"), startTime: "10:00", endTime: "19:00" })}>
            <Plus size={15} />일정 추가
          </Button>
          <Button className="gap-1" onClick={() => { setBulkKey((k) => k + 1); setBulkOpen(true); }}>
            <CalendarRange size={15} />일괄 생성
          </Button>
        </div>
      </div>

      {/* 날짜 네비게이션 + 보기 전환(#71) + 검색 */}
      <Card>
        <CardContent className="pt-6">
          <ScheduleViewBar view={view} />
          {/* 필터(#72) — 직무 여러 개, 겸직이면 지점도, 이름 검색 */}
          <div className="flex flex-wrap items-center gap-2">
            <MultiPick label="직무" options={jobGroups} value={selJobGroups} onChange={setSelJobGroups} allLabel="모든 직무" />
            {branches.length > 1 && <MultiPick label="지점" options={branches} value={selBranches} onChange={setSelBranches} allLabel="모든 지점" />}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <Input placeholder="직원 이름 검색" value={searchName} onChange={(e) => setSearchName(e.target.value)} className="pl-9 h-9 w-48" />
            </div>
            {(selJobGroups.length || selBranches.length || searchName) ? (
              <button type="button" className="text-xs text-gray-500 underline" onClick={() => { setSelJobGroups([]); setSelBranches([]); setSearchName(""); }}>필터 지우기</button>
            ) : null}
            <span className="ml-auto text-xs text-gray-400">{filteredEmployees.length}명 / 전체 {team.length}명</span>
          </div>
        </CardContent>
      </Card>

      {/* 일정 표 — 일·주·월 / 달력형·목록형. 칸을 누르면 추가, 일정을 누르면 고치기 */}
      <Card className="overflow-x-auto">
        <CardContent className="p-0">
          <ScheduleBoard view={view} employees={filteredEmployees} schedules={schedules} loading={loading}
            holidayMap={holidayMap} leaves={leaves} weekHours={weekHours} branchColor={branchColor}
            onEmptyCell={(userId, date) => setEdit({ userId, date, startTime: "10:00", endTime: "19:00" })}
            onSchedule={(s, emp) => setEdit({ id: s.id, userId: emp.id, date: s.date, startTime: s.startTime, endTime: s.endTime, type: s.type, note: s.note ?? null })} />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-100 rounded border border-blue-300" />근무
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-100 rounded border border-green-300" />휴가(승인)
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-100 rounded border border-gray-300" />휴무
        </div>
        <p className="text-gray-400">※ 직원이 신청한 근무일정은 결재에서 승인되면 표시됩니다. 원장이 여기서 넣은 일정(주말 포함)은 바로 확정됩니다. 월 보기의 합계는 화면에 보이는 일정의 근로시간(휴게 제외)입니다.</p>
      </div>

      <ScheduleEditDialog key={edit ? `${edit.id ?? "new"}-${edit.userId}-${edit.date}` : "none"} target={edit} employees={team.map((e) => ({ id: e.id, name: e.name, branch: e.branch }))}
        onClose={() => setEdit(null)} onSaved={onSaved} />
      <ScheduleBulkDialog key={bulkKey} open={bulkOpen} employees={team.map((e) => ({ id: e.id, name: e.name, branch: e.branch }))}
        onClose={() => setBulkOpen(false)} onSaved={onSaved} />
    </div>
  );
}
