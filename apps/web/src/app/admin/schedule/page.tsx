"use client";

import { TemplatePicker } from "@/components/schedule/TemplatePicker";
import { useWeekHours, showWeekWarnings } from "@/components/schedule/WeekHours";
import { useWeekLeaves, LeaveChips, useShowLeave, useBranchColors, WeekTotalCell, empNoText } from "@/components/schedule/WeekExtras";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

type Employee = {
  id: string;
  name: string;
  empNo?: number | null;
  department: string | null;
  position: string | null;
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

type ScheduleGroup = {
  [key: string]: Schedule[];
};

export default function AdminSchedulePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  // 주 근로시간(분, 휴게 제외) — 49시간을 넘으면 빨간 표시(#38). 저장하면 다시 센다
  const [weekReload, setWeekReload] = useState(0);
  const weekHours = useWeekHours(format(startOfWeek(currentWeek, { weekStartsOn: 1 }), "yyyy-MM-dd"), weekReload);

  // 휴가 함께 보기(#61)·지점 색(#74)
  const [showLeave, setShowLeave] = useShowLeave();
  const weekLeaves = useWeekLeaves(format(startOfWeek(currentWeek, { weekStartsOn: 1 }), "yyyy-MM-dd"), showLeave, weekReload);
  const branchColor = useBranchColors();

  // 공휴일 (관리자 > 공휴일 관리 데이터) — 날짜별 이름 맵
  const [holidayMap, setHolidayMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    fetch(`/api/holidays?year=${currentWeek.getFullYear()}`)
      .then((r) => (r.ok ? r.json() : { holidays: [] }))
      .then((d) => setHolidayMap(new Map((d.holidays || []).map((h: { date: string; name: string }) => [h.date, h.name]))))
      .catch(() => {});
  }, [currentWeek]);
  const [filterBranch, setFilterBranch] = useState<string>("ALL");
  const [filterDepartment, setFilterDepartment] = useState<string>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
  // 근무일정 추가 — 종전 창은 입력값을 어디에도 담지 않고 "추가되었습니다"만 띄워 실제로는 저장되지 않았다(2026-10-06 QA 조사에서 적발)
  const emptyForm = () => ({ userId: "", date: format(new Date(), "yyyy-MM-dd"), startTime: "10:00", endTime: "19:00", type: "WORK" as "WORK" | "OFF", note: "" });
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // 주의 시작일과 끝일
  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 1 });
  const daysInWeek = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // 모든 지점과 부서 추출
  const branches = useMemo(() => {
    const unique = new Set(employees.map(e => e.branch).filter(Boolean));
    return Array.from(unique).sort();
  }, [employees]);

  const departments = useMemo(() => {
    const unique = new Set(employees.map(e => e.department).filter(Boolean));
    return Array.from(unique).sort();
  }, [employees]);

  // 직원 데이터 불러오기
  const fetchEmployees = useCallback(async () => {
    try {
      const res = await fetch("/api/employees");
      if (res.ok) {
        const data = await res.json();
        setEmployees(data.employees || []);
      }
    } catch (error) {
      toast.error("직원 목록을 불러올 수 없습니다");
    }
  }, []);

  // 근무 일정 데이터 불러오기 (현재 주 기준)
  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const start = format(startOfWeek(currentWeek, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const end   = format(endOfWeek(currentWeek, { weekStartsOn: 1 }), "yyyy-MM-dd");
      const res = await fetch(`/api/schedule?start=${start}&end=${end}`);
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules || []);
      }
      setWeekReload((n) => n + 1);
    } catch (error) {
      toast.error("근무 일정을 불러올 수 없습니다");
    } finally {
      setLoading(false);
    }
  }, [currentWeek]);

  useEffect(() => {
    fetchEmployees();
    fetchSchedules();
  }, [fetchEmployees, fetchSchedules]);

  // 필터링된 직원 목록
  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => {
      const branchMatch = filterBranch === "ALL" || emp.branch === filterBranch;
      const deptMatch = filterDepartment === "ALL" || emp.department === filterDepartment;
      return branchMatch && deptMatch;
    });
  }, [employees, filterBranch, filterDepartment]);

  // 이번 주의 근무 일정 (userId-date 기준으로 그룹화)
  const weekSchedules = useMemo(() => {
    const schedulesByUserDate: ScheduleGroup = {};
    schedules
      .filter(s => {
        const scheduleDate = new Date(s.date);
        return scheduleDate >= weekStart && scheduleDate <= weekEnd;
      })
      .forEach(s => {
        const key = `${s.userId}-${s.date}`;
        if (!schedulesByUserDate[key]) {
          schedulesByUserDate[key] = [];
        }
        schedulesByUserDate[key].push(s);
      });
    return schedulesByUserDate;
  }, [schedules, weekStart, weekEnd]);

  // 특정 직원의 특정 날짜 일정 가져오기
  const getSchedulesForEmployeeDate = (employeeId: string, date: string) => {
    const key = `${employeeId}-${date}`;
    return weekSchedules[key] || [];
  };

  const handleCreate = async () => {
    if (!form.userId) { toast.error("직원을 선택해주세요."); return; }
    if (!form.date || !form.startTime || !form.endTime) { toast.error("날짜와 시간을 입력해주세요."); return; }
    // 같은 사람·같은 날은 하나뿐이라 저장하면 덮어쓴다 — 이미 있으면 먼저 묻는다
    try {
      const chk = await fetch(`/api/schedule?start=${form.date}&end=${form.date}`);
      if (chk.ok) {
        const d = await chk.json();
        const ex = (d.schedules || []).find((x: Schedule) => x.userId === form.userId && x.date === form.date);
        if (ex && !window.confirm(`이미 ${ex.startTime}~${ex.endTime} 일정이 있습니다. 바꿀까요?`)) return;
      }
    } catch { /* 확인 실패는 저장을 막지 않는다 — 서버가 같은 날 하나만 남긴다 */ }
    setSaving(true);
    try {
      const res = await fetch("/api/schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: form.userId, date: form.date, startTime: form.startTime, endTime: form.endTime, type: form.type, note: form.note.trim() || null, overwrite: true }),   // 위에서 이미 덮어쓰기를 물었다
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(d.error || "근무 일정을 저장하지 못했습니다."); return; }
      toast.success("근무 일정이 추가되었습니다");
      // 주 49시간을 넘으면 경고만(막지 않는다, #38)
      showWeekWarnings(d.warnings);
      setCreateOpen(false);
      fetchSchedules();
    } catch {
      toast.error("네트워크 오류로 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  const handleNextWeek = () => {
    setCurrentWeek(addWeeks(currentWeek, 1));
  };

  const handlePrevWeek = () => {
    setCurrentWeek(subWeeks(currentWeek, 1));
  };

  const handleToday = () => {
    setCurrentWeek(new Date());
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold text-gray-900">근무 일정</h1>
        <div className="flex gap-2">
          <Dialog open={createOpen} onOpenChange={(o) => { setCreateOpen(o); if (o) setForm(emptyForm()); }}>
            <DialogTrigger className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              <Plus size={16} /> 근무일정 추가하기
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>근무 일정 추가</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>직원</Label>
                    <Select value={form.userId} onValueChange={(v) => setForm((f) => ({ ...f, userId: v ?? "" }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="직원 선택">
                          {(() => { const e = employees.find((x) => x.id === form.userId); return e ? `${e.name}${e.branch ? ` (${e.branch})` : ""}` : "직원 선택"; })()}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {[...employees].sort((x, y) => (x.branch || "").localeCompare(y.branch || "") || x.name.localeCompare(y.name)).map(emp => (
                          <SelectItem key={emp.id} value={emp.id}>
                            {emp.name}{emp.branch ? ` (${emp.branch})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>날짜</Label>
                    <Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
                  </div>
                  <div className="col-span-full">
                    <Label>근무일정 템플릿</Label>
                    <TemplatePicker branch={employees.find((x) => x.id === form.userId)?.branch ?? null}
                      onPick={(st, et) => setForm((f) => ({ ...f, startTime: st, endTime: et }))} />
                  </div>
                  <div>
                    <Label>시작 시간</Label>
                    <Input type="time" value={form.startTime} onChange={(e) => setForm((f) => ({ ...f, startTime: e.target.value }))} />
                  </div>
                  <div>
                    <Label>종료 시간</Label>
                    <Input type="time" value={form.endTime} onChange={(e) => setForm((f) => ({ ...f, endTime: e.target.value }))} />
                  </div>
                  <div>
                    <Label>유형</Label>
                    <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: (v as "WORK" | "OFF") ?? "WORK" }))}>
                      <SelectTrigger>
                        <SelectValue>{form.type === "OFF" ? "휴무" : "근무"}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WORK">근무</SelectItem>
                        <SelectItem value="OFF">휴무</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>메모 (선택)</Label>
                    <Input value={form.note} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="예: 방학 특강" />
                  </div>
                </div>
                <p className="text-xs text-gray-500">휴가는 근무일정이 아니라 휴가 신청으로 등록합니다. 지점은 직원의 소속 지점을 따릅니다.</p>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>
                    취소
                  </Button>
                  <Button onClick={handleCreate} disabled={saving}>
                    {saving ? "저장 중…" : "추가"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          {/* 다운로드·업로드는 근무일정 엑셀 업로드(#75)와 함께 만든다 — 연결 없는 버튼은 눌러도 아무 일이 없어 오해를 샀다(2026-10-06) */}
        </div>
      </div>

      {/* 날짜 네비게이션 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handlePrevWeek}>
                <ChevronLeft size={16} />
              </Button>
              <Button variant="ghost" size="sm" onClick={handleToday}>
                오늘
              </Button>
              <Button variant="ghost" size="sm" onClick={handleNextWeek}>
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

          {/* 필터 */}
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-[200px]">
              <Label className="text-sm">지점</Label>
              <Select value={filterBranch} onValueChange={setFilterBranch}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">모든 지점</SelectItem>
                  {branches.map(branch => (
                    <SelectItem key={branch} value={branch}>
                      {branch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 min-w-[200px]">
              <Label className="text-sm">부서</Label>
              <Select value={filterDepartment} onValueChange={setFilterDepartment}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">모든 부서</SelectItem>
                  {departments.map(dept => (
                    <SelectItem key={dept} value={dept}>
                      {dept}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 일정 캘린더 */}
      <Card className="overflow-x-auto">
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-gray-500">
              근무 일정을 불러오는 중...
            </div>
          ) : (
            <div className="min-w-full">
              {/* 날짜 헤더 */}
              <div className="flex border-b sticky top-0 bg-gray-50">
                <div className="w-48 border-r p-3 flex-shrink-0 bg-gray-50 font-medium">
                  직원
                </div>
                <div className="flex flex-1">
                  {daysInWeek.map(day => {
                    const dayName = format(day, "EEE", { locale: ko });
                    const isToday =
                      format(day, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                    const holidayName = holidayMap.get(format(day, "yyyy-MM-dd")); // 법정·임시 공휴일
                    const isHoliday = dayName === "토" || dayName === "일" || !!holidayName;

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
                        {holidayName && <div className="text-[11px] font-normal text-red-500 mt-0.5">{holidayName}</div>}
                      </div>
                    );
                  })}
                </div>
                <div className="w-28 flex-shrink-0 p-3 bg-gray-50 font-medium text-sm" title="이번 주 근로시간(휴게 제외)">주간 합계</div>
              </div>

              {/* 직원별 일정 */}
              <div>
                {filteredEmployees.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">
                    표시할 직원이 없습니다.
                  </div>
                ) : (
                  filteredEmployees.map(employee => (
                    <div key={employee.id} className="flex border-b">
                      <div className="w-48 border-r border-l-4 p-3 flex-shrink-0 bg-gray-50" style={{ borderLeftColor: branchColor(employee.branch) ?? "transparent" }}>
                        <div className="font-medium text-gray-900">
                          {employee.name}
                          {employee.empNo != null && <span className="ml-1.5 text-xs font-normal text-gray-400" title="사번">{empNoText(employee.empNo)}</span>}
                        </div>
                        <div className="text-xs text-gray-600">
                          {employee.position}
                          {employee.branch && (
                            <span className={branchColor(employee.branch) ? "font-medium" : "text-blue-600"} style={{ color: branchColor(employee.branch) }}> · {employee.branch}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-1">
                        {daysInWeek.map(day => {
                          const dateStr = format(day, "yyyy-MM-dd");
                          const daySchedules = getSchedulesForEmployeeDate(employee.id, dateStr);

                          return (
                            <div
                              key={dateStr}
                              className="flex-1 min-w-[150px] border-r p-3 min-h-[120px]"
                            >
                              <LeaveChips data={weekLeaves} userId={employee.id} date={dateStr} />
                              {daySchedules.length === 0 ? (
                                <div className="text-xs text-gray-400">-</div>
                              ) : (
                                <div className="space-y-2">
                                  {daySchedules.map(schedule => (
                                    <div
                                      key={schedule.id}
                                      className="p-2 bg-blue-100 rounded text-xs" style={{ borderLeft: `4px solid ${branchColor(schedule.branch ?? employee.branch) ?? "transparent"}` }}
                                    >
                                      <div className="font-medium text-blue-900">
                                        {schedule.startTime} - {schedule.endTime}
                                      </div>
                                      <Badge
                                        variant="outline"
                                        className="mt-1 text-xs"
                                      >
                                        {schedule.type === "work"
                                          ? "근무"
                                          : schedule.type === "off"
                                          ? "휴무"
                                          : "공휴일"}
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

      {/* 범례 */}
      <div className="flex gap-6 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-100 rounded border border-blue-300" />
          근무
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-green-100 rounded border border-green-300" />
          휴가
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-orange-100 rounded border border-orange-300" />
          출장
        </div>
        <div className="text-gray-400">왼쪽 색 띠 = 지점</div>
      </div>
    </div>
  );
}
