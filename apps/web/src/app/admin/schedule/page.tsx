"use client";

import { TemplatePicker } from "@/components/schedule/TemplatePicker";
import { useWeekHours, showWeekWarnings } from "@/components/schedule/WeekHours";
import { useRangeLeaves, useBranchColors } from "@/components/schedule/WeekExtras";
import { ScheduleBoard, ScheduleViewBar, useScheduleView, type BoardEmployee, type BoardSchedule } from "@/components/schedule/ScheduleBoard";
import { MultiPick } from "@/components/schedule/ScheduleControls";
import { sortEmployees, yearsOf } from "@/lib/schedule-view";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Search, FileSpreadsheet } from "lucide-react";
import { ScheduleImport } from "@/components/schedule/ScheduleImport";
import { format } from "date-fns";
import { toast } from "sonner";

type Employee = BoardEmployee;
type Schedule = BoardSchedule;

export default function AdminSchedulePage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  // 보기 전환(#71): 일·주·월 × 달력형·목록형, 정렬·표시·주 시작 요일(#73) — 사람마다 저장
  const view = useScheduleView();
  // 주 근로시간(분, 휴게 제외) — 49시간을 넘으면 빨간 표시(#38). 저장하면 다시 센다. 주 보기에서만
  const [weekReload, setWeekReload] = useState(0);
  const weekHours = useWeekHours(view.weekMonday, weekReload);

  // 휴가 함께 보기(#61, 보기 설정 「승인된 휴가」)·지점 색(#74)
  const leaves = useRangeLeaves(view.startYmd, view.endYmd, view.show.leave, weekReload);
  const branchColor = useBranchColors();

  // 공휴일 (관리자 > 공휴일 관리 데이터) — 날짜별 이름 맵. 기간이 두 해에 걸치면 둘 다
  const [holidayMap, setHolidayMap] = useState<Map<string, string>>(new Map());
  const yearsKey = yearsOf(view.range).join(",");
  useEffect(() => {
    let alive = true;
    Promise.all(yearsKey.split(",").map((y) => fetch(`/api/holidays?year=${y}`).then((r) => (r.ok ? r.json() : { holidays: [] })).catch(() => ({ holidays: [] }))))
      .then((list) => { if (alive) setHolidayMap(new Map(list.flatMap((d) => (d.holidays || []) as { date: string; name: string }[]).map((h) => [h.date, h.name]))); });
    return () => { alive = false; };
  }, [yearsKey]);
  // 필터(#72): 여러 개 동시 선택(빈 배열 = 전체) + 이름 검색
  const [selBranches, setSelBranches] = useState<string[]>([]);
  const [selDepartments, setSelDepartments] = useState<string[]>([]);
  const [selJobGroups, setSelJobGroups] = useState<string[]>([]);
  const [searchName, setSearchName] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);   // 엑셀 업로드(#75)
  // 근무일정 추가 — 종전 창은 입력값을 어디에도 담지 않고 "추가되었습니다"만 띄워 실제로는 저장되지 않았다(2026-10-06 QA 조사에서 적발)
  const emptyForm = () => ({ userId: "", date: format(new Date(), "yyyy-MM-dd"), startTime: "10:00", endTime: "19:00", type: "WORK" as "WORK" | "OFF", note: "" });
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  // 모든 지점과 부서 추출
  const branches = useMemo(() => {
    const unique = new Set(employees.map(e => e.branch).filter((b): b is string => !!b));
    return Array.from(unique).sort();
  }, [employees]);

  const departments = useMemo(() => {
    const unique = new Set(employees.map(e => e.department).filter((d): d is string => !!d));
    return Array.from(unique).sort();
  }, [employees]);
  const jobGroups = useMemo(() => {
    const unique = new Set(employees.map(e => e.jobGroup || e.position).filter((d): d is string => !!d));
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
    } catch {
      toast.error("직원 목록을 불러올 수 없습니다");
    }
  }, []);

  // 근무 일정 데이터 불러오기 (보기 기간 기준)
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
      setWeekReload((n) => n + 1);
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

  // 필터링·정렬된 직원 목록
  const q = searchName.trim();
  const sortKey = view.prefs.sort;
  const filteredEmployees = useMemo(() => {
    // 목록에서 사라진 값(이름이 바뀐 지점 등)은 세지 않는다 — MultiPick 이 「전체」로 보이는 것과 같은 기준(10/12 검증 4)
    const fb = selBranches.filter((v) => branches.includes(v)), fd = selDepartments.filter((v) => departments.includes(v)), fj = selJobGroups.filter((v) => jobGroups.includes(v));
    const list = employees.filter(emp => {
      if (fb.length && !(emp.branch && fb.includes(emp.branch))) return false;
      if (fd.length && !(emp.department && fd.includes(emp.department))) return false;
      if (fj.length && !fj.includes(emp.jobGroup || emp.position || "")) return false;
      return !q || emp.name.includes(q);
    });
    return sortEmployees(list, sortKey);
  }, [employees, branches, departments, jobGroups, selBranches, selDepartments, selJobGroups, q, sortKey]);

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
          {/* 엑셀 업로드·양식 내려받기(#75) — 달력형·목록형 */}
          <Button variant="outline" className="gap-2" onClick={() => setImportOpen(true)}><FileSpreadsheet size={16} />엑셀 업로드</Button>
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogContent className="max-w-5xl">
              <DialogHeader><DialogTitle>근무일정 엑셀 업로드</DialogTitle></DialogHeader>
              <ScheduleImport employees={filteredEmployees} schedules={schedules} rangeStart={view.startYmd} rangeEnd={view.endYmd} onApplied={fetchSchedules} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* 날짜 네비게이션 + 보기 전환(#71) */}
      <Card>
        <CardContent className="pt-6">
          <ScheduleViewBar view={view} />

          {/* 필터(#72) — 지점·직무·부서를 여러 개 동시에, 이름 검색 */}
          <div className="flex flex-wrap items-center gap-2">
            <MultiPick label="지점" options={branches} value={selBranches} onChange={setSelBranches} allLabel="모든 지점" />
            <MultiPick label="직무" options={jobGroups} value={selJobGroups} onChange={setSelJobGroups} allLabel="모든 직무" />
            <MultiPick label="부서" options={departments} value={selDepartments} onChange={setSelDepartments} allLabel="모든 부서" />
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-gray-400" size={16} />
              <Input placeholder="직원 이름 검색" value={searchName} onChange={(e) => setSearchName(e.target.value)} className="pl-9 h-9 w-48" />
            </div>
            {(selBranches.length || selJobGroups.length || selDepartments.length || searchName) ? (
              <button type="button" className="text-xs text-gray-500 underline" onClick={() => { setSelBranches([]); setSelJobGroups([]); setSelDepartments([]); setSearchName(""); }}>필터 지우기</button>
            ) : null}
            <span className="ml-auto text-xs text-gray-400">{filteredEmployees.length}명 / 전체 {employees.length}명</span>
          </div>
        </CardContent>
      </Card>

      {/* 일정 표 — 일·주·월 / 달력형·목록형 */}
      <Card className="overflow-x-auto">
        <CardContent className="p-0">
          <ScheduleBoard view={view} employees={filteredEmployees} schedules={schedules} loading={loading}
            holidayMap={holidayMap} leaves={leaves} weekHours={weekHours} branchColor={branchColor} />
        </CardContent>
      </Card>

      {/* 범례 */}
      <div className="flex flex-wrap gap-6 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-blue-100 rounded border border-blue-300" />
          근무
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-[#eff6ff] rounded border border-[#bfdbfe]" />
          휴가
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-gray-100 rounded border border-gray-300" />
          휴무
        </div>
        <div className="text-gray-400">왼쪽 색 띠 = 지점 · 월 보기의 합계는 화면에 보이는 일정의 근로시간(휴게 제외)</div>
      </div>
    </div>
  );
}
