"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Plus, Download, Upload } from "lucide-react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

type Employee = {
  id: string;
  name: string;
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
  type: "work" | "leave" | "business_trip"; // 근무, 휴가, 출장
};

type ScheduleGroup = {
  [key: string]: Schedule[];
};

export default function AdminSchedulePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentWeek, setCurrentWeek] = useState(new Date());
  const [filterBranch, setFilterBranch] = useState<string>("ALL");
  const [filterDepartment, setFilterDepartment] = useState<string>("ALL");
  const [createOpen, setCreateOpen] = useState(false);
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

  // 근무 일정 데이터 불러오기
  const fetchSchedules = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/schedule");
      if (res.ok) {
        const data = await res.json();
        setSchedules(data.schedules || []);
      }
    } catch (error) {
      toast.error("근무 일정을 불러올 수 없습니다");
    } finally {
      setLoading(false);
    }
  }, []);

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
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
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
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="직원 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {employees.map(emp => (
                          <SelectItem key={emp.id} value={emp.id}>
                            {emp.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>날짜</Label>
                    <Input type="date" />
                  </div>
                  <div>
                    <Label>시작 시간</Label>
                    <Input type="time" />
                  </div>
                  <div>
                    <Label>종료 시간</Label>
                    <Input type="time" />
                  </div>
                  <div>
                    <Label>지점</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="지점 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        {branches.map(branch => (
                          <SelectItem key={branch} value={branch}>
                            {branch}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>유형</Label>
                    <Select>
                      <SelectTrigger>
                        <SelectValue placeholder="유형 선택" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="work">근무</SelectItem>
                        <SelectItem value="leave">휴가</SelectItem>
                        <SelectItem value="business_trip">출장</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    취소
                  </Button>
                  <Button onClick={() => {
                    toast.success("근무 일정이 추가되었습니다");
                    setCreateOpen(false);
                    fetchSchedules();
                  }}>
                    추가
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Button variant="outline" className="gap-2">
            <Download size={16} /> 다운로드
          </Button>
          <Button variant="outline" className="gap-2">
            <Upload size={16} /> 업로드
          </Button>
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
                      <div className="w-48 border-r p-3 flex-shrink-0 bg-gray-50">
                        <div className="font-medium text-gray-900">{employee.name}</div>
                        <div className="text-xs text-gray-600">{employee.position}</div>
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
                              {daySchedules.length === 0 ? (
                                <div className="text-xs text-gray-400">-</div>
                              ) : (
                                <div className="space-y-2">
                                  {daySchedules.map(schedule => (
                                    <div
                                      key={schedule.id}
                                      className="p-2 bg-blue-100 rounded text-xs"
                                    >
                                      <div className="font-medium text-blue-900">
                                        {schedule.startTime} - {schedule.endTime}
                                      </div>
                                      <div className="text-blue-700">{schedule.branch}</div>
                                      <Badge
                                        variant="outline"
                                        className="mt-1 text-xs"
                                      >
                                        {schedule.type === "work"
                                          ? "근무"
                                          : schedule.type === "leave"
                                          ? "휴가"
                                          : "출장"}
                                      </Badge>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
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
      </div>
    </div>
  );
}
