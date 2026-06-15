"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { format, startOfWeek, endOfWeek, eachDayOfInterval, addWeeks, subWeeks } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

type Employee = {
  id: string;
  name: string;
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

  const weekStart = startOfWeek(currentWeek, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(currentWeek, { weekStartsOn: 1 });
  const daysInWeek = eachDayOfInterval({ start: weekStart, end: weekEnd });

  // 지점 정보
  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then(d => setBranch(d.user?.branch || d.branch || ""))
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

  const filteredEmployees = useMemo(() => {
    return employees.filter(emp => !searchName || emp.name.includes(searchName));
  }, [employees, searchName]);

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
          <p className="text-gray-600 mt-1">{branch} - 팀원 근무일정 조회</p>
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
              </div>

              {/* 직원별 일정 */}
              <div>
                {filteredEmployees.length === 0 ? (
                  <div className="p-8 text-center text-gray-500">표시할 직원이 없습니다.</div>
                ) : (
                  filteredEmployees.map(employee => (
                    <div key={employee.id} className="flex border-b">
                      <div className="w-48 border-r p-3 flex-shrink-0 bg-gray-50">
                        <div className="font-medium text-gray-900">{employee.name}</div>
                        <div className="text-xs text-gray-600">
                          {employee.jobGroup || employee.position}
                          {employee.branch && <span className="text-blue-600"> · {employee.branch}</span>}
                        </div>
                      </div>
                      <div className="flex flex-1">
                        {daysInWeek.map(day => {
                          const dateStr = format(day, "yyyy-MM-dd");
                          const daySchedules = getSchedules(employee.id, dateStr);
                          return (
                            <div key={dateStr} className="flex-1 min-w-[150px] border-r p-3 min-h-[120px]">
                              {daySchedules.length === 0 ? (
                                <div className="text-xs text-gray-400">-</div>
                              ) : (
                                <div className="space-y-2">
                                  {daySchedules.map(schedule => (
                                    <div key={schedule.id} className="p-2 bg-blue-100 rounded text-xs">
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
        <p className="text-gray-400">※ 근무일정은 직원 신청 후 결재(휴가, 근무일정)에서 최종 승인되면 표시됩니다.</p>
      </div>
    </div>
  );
}
