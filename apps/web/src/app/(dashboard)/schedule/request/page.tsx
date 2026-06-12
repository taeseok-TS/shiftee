"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Calendar, AlertCircle, ChevronRight } from "lucide-react";
import { format, eachDayOfInterval, isWeekend, getDay } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

/* ── 타입 ── */
type ScheduleTemplate = {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  hours: number;
};

type ApprovalLineStep = {
  id: string;
  order: number;
  approver: {
    id: string;
    name: string;
    position: string | null;
  };
};

/* ── 근무 템플릿 (출근 8AM~1PM, 9시간 근무 기본) ── */
const SCHEDULE_TEMPLATES: ScheduleTemplate[] = [
  { id: "8-5", name: "8-5 (8AM-5PM)", startTime: "08:00", endTime: "17:00", hours: 9 },
  { id: "9-6", name: "9-6 (9AM-6PM)", startTime: "09:00", endTime: "18:00", hours: 9 },
  { id: "10-7", name: "10-7 (10AM-7PM)", startTime: "10:00", endTime: "19:00", hours: 9 },
  { id: "11-8", name: "11-8 (11AM-8PM)", startTime: "11:00", endTime: "20:00", hours: 9 },
  { id: "12-9", name: "12-9 (12PM-9PM)", startTime: "12:00", endTime: "21:00", hours: 9 },
  { id: "1-10", name: "1-10 (1PM-10PM)", startTime: "13:00", endTime: "22:00", hours: 9 },
  { id: "9-5", name: "9-5 (9AM-5PM)", startTime: "09:00", endTime: "17:00", hours: 8 },
  { id: "10-6", name: "10-6 (10AM-6PM)", startTime: "10:00", endTime: "18:00", hours: 8 },
];

/* ── 휴게시간 계산 (근로기준법: 4.5시간 이상 30분, 9시간 이상 1시간) ── */
function breakHours(spanHours: number) {
  if (spanHours >= 9) return 1;
  if (spanHours >= 4.5) return 0.5;
  return 0;
}

/* ── 시간 직접 설정 → 템플릿 변환 ── */
function buildCustomTemplate(start: string, end: string): ScheduleTemplate | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const minutes = eh * 60 + em - (sh * 60 + sm);
  if (minutes <= 0) return null;
  const hours = Math.round((minutes / 60) * 10) / 10;
  return {
    id: "custom",
    name: `직접설정 (${start}~${end})`,
    startTime: start,
    endTime: end,
    hours,
  };
}

export default function ScheduleRequestPage() {
  const [step, setStep] = useState(1); // 1: 템플릿, 2: 달력, 3: 승인권자, 4: 확인
  const [selectedTemplate, setSelectedTemplate] = useState<ScheduleTemplate | null>(null);
  const [customStart, setCustomStart] = useState("09:00");
  const [customEnd, setCustomEnd] = useState("18:00");

  // 직접 설정 시간 변경 → 선택된 템플릿 갱신
  const handleCustomTimeChange = (start: string, end: string) => {
    setCustomStart(start);
    setCustomEnd(end);
    const custom = buildCustomTemplate(start, end);
    if (custom) setSelectedTemplate(custom);
  };
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set());
  const [approvalLine, setApprovalLine] = useState<ApprovalLineStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [myId, setMyId] = useState("");
  // 날짜별 승인된 휴가 비율 (1=종일, 0.5=반차, 0.25=반반차)
  const [leaveMap, setLeaveMap] = useState<Record<string, number>>({});

  // 본인 ID 조회
  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json()).then(d => setMyId(d.user?.id || "")).catch(() => {});
  }, []);

  // 선택 기간의 승인된 휴가 조회 → 날짜별 차감 비율 맵 생성
  useEffect(() => {
    if (!startDate) { setLeaveMap({}); return; }
    const year = new Date(startDate).getFullYear();
    fetch(`/api/leave?status=APPROVED&year=${year}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, number> = {};
        (d.requests || [])
          .filter((req: any) => !myId || req.userId === myId || req.user?.id === myId)
          .forEach((req: any) => {
            const frac = req.type?.startsWith("QUARTER") ? 0.25 : req.type?.includes("HALF") ? 0.5 : 1;
            eachDayOfInterval({ start: new Date(req.startDate), end: new Date(req.endDate) }).forEach(day => {
              const key = format(day, "yyyy-MM-dd");
              map[key] = Math.max(map[key] || 0, frac);
            });
          });
        setLeaveMap(map);
      })
      .catch(() => setLeaveMap({}));
  }, [startDate, myId]);

  // 사용자의 결재라인 조회
  useEffect(() => {
    const fetchApprovalLine = async () => {
      try {
        const res = await fetch("/api/approval-line");
        if (res.ok) {
          const data = await res.json();
          setApprovalLine(data.line?.steps || []);
        }
      } catch (error) {
        console.error("결재라인 조회 오류:", error);
      }
    };
    fetchApprovalLine();
  }, []);

  // 날짜 범위의 모든 평일 계산
  const calculateWeekdays = useCallback(() => {
    if (!startDate || !endDate) return [];

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (start > end) {
      toast.error("시작일이 종료일보다 클 수 없습니다");
      return [];
    }

    const days = eachDayOfInterval({ start, end }).filter(day => !isWeekend(day));
    return days;
  }, [startDate, endDate]);

  // 달력 페이지에서 평일 자동 선택
  const handleAutoSelectWeekdays = () => {
    const weekdays = calculateWeekdays();
    if (weekdays.length === 0) {
      toast.error("선택할 평일이 없습니다");
      return;
    }

    const dates = new Set<string>();
    weekdays.forEach(day => {
      dates.add(format(day, "yyyy-MM-dd"));
    });
    setSelectedDates(dates);
  };

  // 총 근무 시간 계산 (휴게시간 + 승인된 휴가 차감)
  const spanHours = selectedTemplate?.hours || 0;          // 출퇴근 시간 간격
  const dailyBreak = breakHours(spanHours);                // 일일 휴게시간
  const dailyNet = Math.max(spanHours - dailyBreak, 0);    // 일일 실근무시간
  const leaveDeduction = Math.round(
    Array.from(selectedDates).reduce((acc, d) => acc + (leaveMap[d] || 0) * dailyNet, 0) * 10
  ) / 10;                                                  // 휴가 차감시간
  const totalHours = Math.round((selectedDates.size * dailyNet - leaveDeduction) * 10) / 10;

  // 날짜 미선택 시에도 안전한 포맷 (빈 값이면 "-" 표시)
  const fmtDate = (value: string, pattern: string) =>
    value ? format(new Date(value), pattern, { locale: ko }) : "-";

  // 신청 제출
  const handleSubmit = async () => {
    try {
      if (!selectedTemplate || !startDate || !endDate || selectedDates.size === 0) {
        toast.error("모든 정보를 입력해주세요");
        return;
      }

      setLoading(true);

      // 날짜별 일정 데이터 생성
      const scheduleData = Array.from(selectedDates).map(date => ({
        date,
        startTime: selectedTemplate.startTime,
        endTime: selectedTemplate.endTime,
      }));

      const res = await fetch("/api/schedule-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templateId: selectedTemplate.id,
          templateName: selectedTemplate.name,
          startDate,
          endDate,
          scheduleData,
          totalHours,
        }),
      });

      if (res.ok) {
        toast.success("근무일정 신청이 완료되었습니다");
        setTimeout(() => {
          window.location.href = "/schedule";
        }, 1500);
      } else {
        const data = await res.json();
        toast.error(data.error || "신청 중 오류가 발생했습니다");
      }
    } catch (error) {
      toast.error("오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 진행 상태 */}
      <div className="flex items-center gap-4">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
          step >= 1 ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"
        }`}>
          1
        </div>
        <div className={`flex-1 h-1 ${step >= 2 ? "bg-blue-600" : "bg-gray-200"}`} />
        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
          step >= 2 ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"
        }`}>
          2
        </div>
        <div className={`flex-1 h-1 ${step >= 3 ? "bg-blue-600" : "bg-gray-200"}`} />
        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
          step >= 3 ? "bg-blue-600 text-white" : "bg-gray-200 text-gray-600"
        }`}>
          3
        </div>
      </div>

      {/* Step 1: 템플릿 선택 */}
      {step === 1 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>근무 시간 템플릿 선택</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SCHEDULE_TEMPLATES.map(template => (
                  <button
                    key={template.id}
                    onClick={() => setSelectedTemplate(template)}
                    className={`p-4 border-2 rounded-lg transition-all ${
                      selectedTemplate?.id === template.id
                        ? "border-blue-600 bg-blue-50"
                        : "border-gray-200 hover:border-blue-300"
                    }`}
                  >
                    <div className="text-lg font-bold text-gray-900">{template.name}</div>
                    <div className="text-sm text-gray-600">{template.hours}시간</div>
                  </button>
                ))}
              </div>

              {/* 원하는 템플릿이 없을 때: 시간 직접 설정 */}
              <div
                onClick={() => {
                  const custom = buildCustomTemplate(customStart, customEnd);
                  if (custom) setSelectedTemplate(custom);
                }}
                className={`p-4 border-2 rounded-lg transition-all cursor-pointer ${
                  selectedTemplate?.id === "custom"
                    ? "border-blue-600 bg-blue-50"
                    : "border-dashed border-gray-300 hover:border-blue-300"
                }`}
              >
                <div className="text-lg font-bold text-gray-900 mb-2">⚙️ 직접 설정</div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">출근</span>
                    <input
                      type="time"
                      value={customStart}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleCustomTimeChange(e.target.value, customEnd)}
                      className="px-2 py-1.5 border rounded-md text-sm"
                    />
                  </div>
                  <span className="text-gray-400">~</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600">퇴근</span>
                    <input
                      type="time"
                      value={customEnd}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => handleCustomTimeChange(customStart, e.target.value)}
                      className="px-2 py-1.5 border rounded-md text-sm"
                    />
                  </div>
                  <span className="text-sm font-medium text-blue-600">
                    {buildCustomTemplate(customStart, customEnd)
                      ? `${buildCustomTemplate(customStart, customEnd)!.hours}시간`
                      : "시간을 확인해주세요"}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4">
                <Button
                  onClick={() => setStep(2)}
                  disabled={!selectedTemplate}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  다음 <ChevronRight size={16} className="ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 2: 달력 선택 */}
      {step === 2 && selectedTemplate && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>근무 기간 선택</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">시작일</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">종료일</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {startDate && endDate && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <label className="block text-sm font-medium text-gray-700">평일 자동 선택</label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleAutoSelectWeekdays}
                    >
                      모든 평일 선택
                    </Button>
                  </div>

                  <div className="grid grid-cols-7 gap-2">
                    {/* 요일 헤더 */}
                    {["일", "월", "화", "수", "목", "금", "토"].map((day, idx) => (
                      <div key={idx} className="text-center text-sm font-semibold text-gray-600 py-2">
                        {day}
                      </div>
                    ))}

                    {/* 시작 요일 위치 맞춤 (빈 칸 패딩) */}
                    {Array.from({ length: getDay(new Date(startDate)) }).map((_, i) => (
                      <div key={`pad-${i}`} />
                    ))}

                    {/* 달력 */}
                    {startDate && endDate && eachDayOfInterval({
                      start: new Date(startDate),
                      end: new Date(endDate),
                    }).map(day => {
                      const dateStr = format(day, "yyyy-MM-dd");
                      const isSelected = selectedDates.has(dateStr);
                      const isWeekendDay = isWeekend(day);
                      const leaveFrac = leaveMap[dateStr] || 0;

                      return (
                        <button
                          key={dateStr}
                          onClick={() => {
                            if (!isWeekendDay) {
                              const newDates = new Set(selectedDates);
                              if (newDates.has(dateStr)) {
                                newDates.delete(dateStr);
                              } else {
                                newDates.add(dateStr);
                              }
                              setSelectedDates(newDates);
                            }
                          }}
                          disabled={isWeekendDay}
                          className={`p-2 rounded text-sm font-medium transition-all ${
                            isWeekendDay
                              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                              : isSelected
                              ? "bg-blue-600 text-white"
                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                          }`}
                        >
                          {format(day, "d")}
                          {leaveFrac > 0 && !isWeekendDay && (
                            <span className={`block text-[9px] leading-tight ${isSelected ? "text-amber-200" : "text-amber-600"}`}>
                              {leaveFrac === 1 ? "휴가" : leaveFrac === 0.5 ? "반차" : "반반차"}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 선택 요약 */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-2 text-blue-700">
                <Calendar size={16} className="mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <div>
                    선택된 날짜: <span className="font-semibold">{selectedDates.size}일</span>
                    {selectedTemplate && (
                      <span className="ml-3 text-sm">
                        (일 {spanHours}시간 − 휴게 {dailyBreak}시간 = 실근무 <span className="font-semibold">{dailyNet}시간</span>)
                      </span>
                    )}
                  </div>
                  {leaveDeduction > 0 && (
                    <div className="text-sm text-amber-700">
                      승인된 휴가 차감: <span className="font-semibold">-{leaveDeduction}시간</span>
                    </div>
                  )}
                  {selectedTemplate && (
                    <div>
                      총 근무시간: <span className="font-semibold text-base">{totalHours}시간</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setStep(1)}>
                  이전
                </Button>
                <Button
                  onClick={() => setStep(3)}
                  disabled={selectedDates.size === 0}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  다음 <ChevronRight size={16} className="ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Step 3: 결재라인 확인 */}
      {step === 3 && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>결재라인 확인</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {approvalLine.length === 0 ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-2 text-red-700">
                  <AlertCircle size={16} />
                  <span>결재라인이 설정되지 않았습니다. 관리자에게 문의해주세요.</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {approvalLine.map((step, idx) => (
                    <div key={step.id} className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold">
                        {idx + 1}
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{step.approver.name}</div>
                        <div className="text-sm text-gray-600">{step.approver.position || "직책 미정"}</div>
                      </div>
                      {idx < approvalLine.length - 1 && (
                        <ChevronRight className="text-gray-400" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 신청 요약 */}
              <div className="bg-gray-50 p-4 rounded-lg space-y-2">
                <h4 className="font-semibold text-gray-900">신청 요약</h4>
                <div className="text-sm text-gray-600 space-y-1">
                  <div>근무 시간: <span className="font-medium">{selectedTemplate?.name}</span></div>
                  <div>기간: <span className="font-medium">{fmtDate(startDate, "yyyy년 M월 d일")} ~ {fmtDate(endDate, "M월 d일")}</span></div>
                  <div>선택 날짜: <span className="font-medium">{selectedDates.size}일</span></div>
                  <div>총 시간: <span className="font-medium text-blue-600">{totalHours}시간</span></div>
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setStep(2)}>
                  이전
                </Button>
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={approvalLine.length === 0}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  신청하기
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 최종 확인 다이얼로그 */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>근무일정 신청 확인</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
              <h4 className="font-semibold text-gray-900">신청 내용</h4>
              <div className="text-sm text-gray-700 space-y-1">
                <div>• 근무 시간: {selectedTemplate?.name}</div>
                <div>• 기간: {fmtDate(startDate, "yyyy년 M월 d일")} ~ {fmtDate(endDate, "M월 d일")}</div>
                <div>• 선택 날짜: {selectedDates.size}일</div>
                <div>• 총 근무시간: <span className="font-bold text-blue-600">{totalHours}시간</span></div>
              </div>
            </div>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="text-sm text-amber-800">
                다음 결재자에게 요청이 전달됩니다: {approvalLine[0]?.approver.name}
              </p>
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={loading}>
                취소
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin mr-2" />
                    제출 중...
                  </>
                ) : (
                  "제출하기"
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
