"use client";

import { useWeekHours } from "@/components/schedule/WeekHours";
import { useWeekLeaves, LeaveChips, useShowLeave, useBranchColors, WeekTotalCell, empNoText } from "@/components/schedule/WeekExtras";
import { ScheduleEditDialog, ScheduleBulkDialog, type EditTarget } from "@/components/schedule/ScheduleDialogs";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Search, Plus, CalendarRange } from "lucide-react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

type Employee = {
  id: string;
  name: string;
  empNo?: number | null;
  position: string | null;
  jobGroup: string | null;
  branch: string | null;
};

type Schedule = {
  id: string;
  userId: string;
  date: string;
  startTime: string;
  endTime: string;
  branch: string | null;
  type: string; // work(근무), off(휴무), holiday(공휴일)
  note?: string | null;
};

type ScheduleGroup = { [key: string]: Schedule[] };

export default function ManagerSchedulePage() {
  const [branch, setBranch] = useState("");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [searchName, setSearchName] = useState("");
  // 일정 관리(2026-10-07 QA #18 #12) — 칸을 누르면 추가, 일정을 누르면 고치기·지우기
  const [edit, setEdit] = useState<EditTarget>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkKey, setBulkKey] = useState(0);   // 열 때마다 새 창(이전 선택이 남지 않게)
  const [me, setMe] = useState<{ id: string; name: string; branch: string | null } | null>(null);

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 1 });
  const daysInWeek = eachDayOfInterval({ start: weekStart, end: weekEnd });

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

  // 주 근로시간 — 49시간을 넘으면 빨간 표시(#38, 담당 지점만). 일정을 저장하면 다시 센다
  const [weekReload, setWeekReload] = useState(0);
  const weekHours = useWeekHours(format(startOfWeek(currentWeek, { weekStartsOn: 1 }), "yyyy-MM-dd"), weekReload);

  // 휴가 함께 보기(#61)·지점 색(#74)
  const [showLeave, setShowLeave] = useShowLeave();
  const weekLeaves = useWeekLeaves(format(startOfWeek(currentWeek, { weekStartsOn: 1 }), "yyyy-MM-dd"), showLeave, weekReload);
  const branchColor = useBranchColors();

  // 근무 일정 (현재 주 기준)
  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const start = format(startOfWeek(currentWeek, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const end = format(endOfWeek(currentWeek, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const res = await fetch(`/api/schedule?start=${start}&end=${end}`);
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules || []);
      }
      setWeekReload((n) => n + 1);
    } catch {
      toast.error("근무 일정을 불러올 수 없습니다");
    } finally {
      setLoading(false);
    }
  }, [currentWeek]);

  useEffect(() => {
    fetchEmployees();
    fetchSchedules();
  }, [fetchEmployees, fetchSchedules]);

  // 원장 본인 일정도 여기서 넣는다(본부 답변 #7) — 직원 목록에 본인이 없으면 맨 앞에 붙인다
  const team = useMemo(() => {
    if (!me || employees.some((e) => e.id === me.id)) return employees;
    return [{ id: me.id, name: `${me.name} (본인)`, position: null, jobGroup: "원장", branch: me.branch }, ...employees];
  }, [employees, me]);
  const filteredEmployees = useMemo(() => {
    return team.filter(emp => !searchName || emp.name.includes(searchName));
  }, [team, searchName]);

  const weekSchedules = useMemo(() => {
    const map: ScheduleGroup = {};
    schedules.forEach(s => {
      const key = `${s.userId}-${s.date}`;
      if (!map[key]) map[key] = [];
      map[key].push(s);
    });
    return map;
  }, [schedules]);

  const getSchedules = (employeeId: string, date: string) => weekSchedules[`${employeeId}-${date}`] || [];

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

      {/* 날짜 네비게이션 + 검색 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}>
                <ChevronLeft size={16} />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCurrentWeek(new Date())}>
                오늘
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}>
                <ChevronRight size={16} />
              </Button>
              <span className="text-lg font-semibold ml-4">
                {format(weekStart, "yyyy년 M월 d일", { locale: ko })} - {format(weekEnd, "M월 d일", { locale: ko })}
              </span>
            </div>
            {/* 휴가 함께 보기(#61) — 이 브라우저에 기억 */}
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input type="checkbox" checked={showLeave} onChange={(e) => setShowLeave(e.target.checked)} />휴가 표시
            </label>
          </div>
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
            <Input
              placeholder="직원 이름으로 검색..."
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              className="pl-10"
            />
          </div>
        </CardContent>
      </Card>

      {/* 일정 캘린더 */}
      <Card className="overflow-x-auto">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500">근무 일정을 불러오는 중...</div>
          ) : (
            <div className="min-w-full">
              {/* 날짜 헤더 */}
              <div className="flex border-b sticky top-0 bg-gray-50">
                <div className="w-48 border-r p-3 flex-shrink-0 bg-gray-50 font-medium">직원</div>
                <div className="flex flex-1">
                  {daysInWeek.map(day => {
                    const dayName = format(day, "EEE", { locale: ko });
                    const isToday = format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                    const isHoliday = dayName === "토" || dayName === "일";
                    return (
                      <div
                        key={format(day, "yyyy-MM-dd")}
                        className={`flex-1 min-w-[150px] border-r p-3 text-center font-medium ${
                          isToday ? "bg-blue-50" : isHoliday ? "bg-red-50" : "bg-white"
                        }`}
                      >
                        <div className={isToday ? "text-blue-600" : isHoliday ? "text-red-600" : ""}>
                          {format(day, "d일(EEE)", { locale: ko })}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="w-28 flex-shrink-0 p-3 bg-gray-50 font-medium text-sm" title="이번 주 근로시간(휴게 제외)">주간 합계</div>
              </div>

              {/* 직원별 일정 */}
              <div>
                {filteredEmployees.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">표시할 직원이 없습니다.</div>
                ) : (
                  filteredEmployees.map(employee => (
                    <div key={employee.id} className="flex border-b">
                      <div className="w-48 border-r border-l-4 p-3 flex-shrink-0 bg-gray-50" style={{ borderLeftColor: branchColor(employee.branch) ?? "transparent" }}>
                        <div className="font-medium text-gray-900">
                          {employee.name}
                          {employee.empNo != null && <span className="ml-1.5 text-xs font-normal text-gray-400" title="사번">{empNoText(employee.empNo)}</span>}
                        </div>
                        <div className="text-xs text-gray-600">
                          {employee.jobGroup || employee.position}
                          {employee.branch && <span className={branchColor(employee.branch) ? "font-medium" : "text-blue-600"} style={{ color: branchColor(employee.branch) }}> · {employee.branch}</span>}
                        </div>
                      </div>
                      <div className="flex flex-1">
                        {daysInWeek.map(day => {
                          const dateStr = format(day, "yyyy-MM-dd");
                          const daySchedules = getSchedules(employee.id, dateStr);
                          return (
                            <div key={dateStr} className="flex-1 min-w-[150px] border-r p-3 min-h-[120px]">
                              <LeaveChips data={weekLeaves} userId={employee.id} date={dateStr} />
                              {daySchedules.length === 0 ? (
                                <button className="w-full h-full min-h-[90px] text-xs text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded"
                                  onClick={() => setEdit({ userId: employee.id, date: dateStr, startTime: "10:00", endTime: "19:00" })}>
                                  + 추가
                                </button>
                              ) : (
                                <div className="space-y-2">
                                  {daySchedules.map(schedule => (
                                    <div key={schedule.id} className="p-2 bg-blue-100 rounded text-xs cursor-pointer hover:ring-2 hover:ring-blue-300" style={{ borderLeft: `4px solid ${branchColor(schedule.branch ?? employee.branch) ?? "transparent"}` }}
                                      role="button" tabIndex={0}
                                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEdit({ id: schedule.id, userId: employee.id, date: dateStr, startTime: schedule.startTime, endTime: schedule.endTime, type: schedule.type, note: schedule.note ?? null }); } }}
                                      onClick={() => setEdit({ id: schedule.id, userId: employee.id, date: dateStr, startTime: schedule.startTime, endTime: schedule.endTime, type: schedule.type, note: schedule.note ?? null })}>
                                      <div className="font-medium text-blue-900">
                                        {schedule.startTime} - {schedule.endTime}
                                      </div>
                                      <Badge variant="outline" className="mt-1 text-xs">
                                        {schedule.type === "work" ? "근무" : schedule.type === "off" ? "휴무" : "공휴일"}
                                      </Badge>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      <WeekTotalCell data={weekHours} userId={employee.id} />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-100 rounded border border-blue-300" />근무
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-100 rounded border border-green-300" />휴가(승인)
        </div>
        <p className="text-gray-400">※ 직원이 신청한 근무일정은 결재에서 승인되면 표시됩니다. 원장이 여기서 넣은 일정(주말 포함)은 바로 확정됩니다.</p>
      </div>

      <ScheduleEditDialog key={edit ? `${edit.id ?? "new"}-${edit.userId}-${edit.date}` : "none"} target={edit} employees={team.map((e) => ({ id: e.id, name: e.name, branch: e.branch }))}
        onClose={() => setEdit(null)} onSaved={fetchSchedules} />
      <ScheduleBulkDialog key={bulkKey} open={bulkOpen} employees={team.map((e) => ({ id: e.id, name: e.name, branch: e.branch }))}
        onClose={() => setBulkOpen(false)} onSaved={fetchSchedules} />
    </div>
  );
}
