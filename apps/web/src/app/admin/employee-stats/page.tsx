"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, getYear, getMonth } from "date-fns";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { downloadActiveEmployeesExcel, downloadResignedEmployeesExcel, downloadResignedSummaryExcel } from "@/lib/export-excel";

type ActiveStats = {
  total: number;
  byPosition: Record<string, number>;
  byBranch: Record<string, { total: number; [key: string]: number }>;
  date: string;
  period: string;
  employees: Array<{ id: string; name: string; jobGroup: string | null; position: string | null; branch: string | null }>;
};

type ResignedStatsAnnual = {
  year: string;
  total: number;
  byMonth: Record<string, { total: number; [key: string]: number }>;
  byPosition: Record<string, number>;
};

type ResignedStatsMonthly = {
  month: string;
  total: number;
  employees: Array<{
    id: string;
    name: string;
    jobGroup: string | null;
    position: string | null;
    branch: string | null;
    hireDate: string | null;
    resignDate: string | null;
    resignReason: string | null;
  }>;
};

// 직군 표시 순서 (기본 직군 먼저, 그 외는 가나다순)
const JOB_ORDER = ["원장", "CM", "TM", "코디"];
function orderedPositions(byPosition: Record<string, number>) {
  const keys = Object.keys(byPosition);
  return [
    ...JOB_ORDER.filter((k) => keys.includes(k)),
    ...keys.filter((k) => !JOB_ORDER.includes(k)).sort(),
  ];
}

export default function EmployeeStatsPage() {
  const [activeStats, setActiveStats] = useState<ActiveStats | null>(null);
  const [activePeriod, setActivePeriod] = useState<"month" | "year">("month");
  const [activeDate, setActiveDate] = useState<string>(
    format(new Date(), "yyyy-MM")
  );

  const [resignedStatsAnnual, setResignedStatsAnnual] =
    useState<ResignedStatsAnnual | null>(null);
  const [resignedStatsMonthly, setResignedStatsMonthly] =
    useState<ResignedStatsMonthly | null>(null);
  const [resignedPeriod, setResignedPeriod] = useState<"month" | "year">("year");
  const [resignedYear, setResignedYear] = useState<string>(
    getYear(new Date()).toString()
  );
  const [resignedMonth, setResignedMonth] = useState<string>(
    format(new Date(), "yyyy-MM")
  );

  const [loading, setLoading] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ResignedStatsMonthly['employees'][0] | null>(null);

  // 직원 삭제 열기
  function handleDeleteEmployee(emp: ResignedStatsMonthly['employees'][0]) {
    setDeleteTarget(emp);
    setDeleteConfirmOpen(true);
  }

  // 직원 삭제 실행
  async function confirmDelete() {
    if (!deleteTarget) return;

    try {
      const res = await fetch(`/api/employees/${deleteTarget.id}/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "삭제 실패");
        return;
      }
      toast.success(`${deleteTarget.name} 직원이 삭제되었습니다.\n(30일 후 자동 완전 삭제됩니다)`);
      setDeleteConfirmOpen(false);
      fetchResignedMonthly(); // 목록 새로고침
    } catch (error) {
      console.error("직원 삭제 오류:", error);
      toast.error("삭제 중 오류가 발생했습니다.");
    }
  }

  // 재직자 현황 조회
  async function fetchActiveStats() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.set("period", activePeriod);
      params.set("date", activeDate);

      console.log("[fetchActiveStats] Calling API with params:", { activePeriod, activeDate });
      const res = await fetch(`/api/employees/stats/active?${params}`, {
        credentials: "include", // 쿠키 포함
      });
      console.log("[fetchActiveStats] Response status:", res.status);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("[fetchActiveStats] Error response:", errorData);
        throw new Error(`조회 실패 (${res.status}): ${errorData.error || "Unknown error"}`);
      }

      const data = await res.json();
      console.log("[fetchActiveStats] Success:", data);
      setActiveStats(data);
    } catch (error) {
      console.error("[fetchActiveStats] Error:", error);
      toast.error(`재직자 현황 조회에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  // 퇴직자 현황 조회 (연간)
  async function fetchResignedAnnual() {
    try {
      setLoading(true);
      console.log("[fetchResignedAnnual] Calling API with year:", resignedYear);
      const res = await fetch(
        `/api/employees/stats/resigned?year=${resignedYear}`,
        {
          credentials: "include", // 쿠키 포함
        }
      );
      console.log("[fetchResignedAnnual] Response status:", res.status);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("[fetchResignedAnnual] Error response:", errorData);
        throw new Error(`조회 실패 (${res.status}): ${errorData.error || "Unknown error"}`);
      }

      const data = await res.json();
      console.log("[fetchResignedAnnual] Success:", data);
      setResignedStatsAnnual(data);
      setResignedStatsMonthly(null);
    } catch (error) {
      console.error("[fetchResignedAnnual] Error:", error);
      toast.error(`퇴직자 현황 조회에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  // 퇴직자 현황 조회 (월간)
  async function fetchResignedMonthly() {
    try {
      setLoading(true);
      console.log("[fetchResignedMonthly] Calling API with month:", resignedMonth);
      const res = await fetch(
        `/api/employees/stats/resigned?month=${resignedMonth}`,
        {
          credentials: "include", // 쿠키 포함
        }
      );
      console.log("[fetchResignedMonthly] Response status:", res.status);

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("[fetchResignedMonthly] Error response:", errorData);
        throw new Error(`조회 실패 (${res.status}): ${errorData.error || "Unknown error"}`);
      }

      const data = await res.json();
      console.log("[fetchResignedMonthly] Success:", data);
      setResignedStatsMonthly(data);
      setResignedStatsAnnual(null);
    } catch (error) {
      console.error("[fetchResignedMonthly] Error:", error);
      toast.error(`퇴직자 현황 조회에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  }

  // 초기 로드
  useEffect(() => {
    fetchActiveStats();
    fetchResignedAnnual();
  }, []);

  // 재직자 현황 기간 변경
  useEffect(() => {
    if (activePeriod === "year") {
      const year = getYear(new Date()).toString();
      setActiveDate(year);
    } else {
      setActiveDate(format(new Date(), "yyyy-MM"));
    }
  }, [activePeriod]);

  const handleActivePeriodChange = (period: "month" | "year") => {
    setActivePeriod(period);
  };

  const handleResignedPeriodChange = (period: "month" | "year") => {
    setResignedPeriod(period);
    if (period === "year") {
      setResignedYear(getYear(new Date()).toString());
    } else {
      setResignedMonth(format(new Date(), "yyyy-MM"));
    }
  };

  // 재직자 현황 카드
  const renderActiveStats = () => {
    if (!activeStats) return null;

    return (
      <div className="space-y-6">
        {/* 기간 선택 */}
        <div className="flex items-end gap-4">
          <div className="space-y-2">
            <Label>기간</Label>
            <Select
              value={activePeriod}
              onValueChange={(v) =>
                handleActivePeriodChange(v as "month" | "year")
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="month">월말</SelectItem>
                <SelectItem value="year">연말</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>날짜</Label>
            <div className="flex gap-2">
              {activePeriod === "year" ? (
                <select
                  value={activeDate}
                  onChange={(e) => setActiveDate(e.target.value)}
                  className="px-3 py-2 border rounded-md text-sm"
                >
                  {Array.from({ length: 5 }, (_, i) => {
                    const year = getYear(new Date()) - i;
                    return (
                      <option key={year} value={year.toString()}>
                        {year}년
                      </option>
                    );
                  })}
                </select>
              ) : (
                <input
                  type="month"
                  value={activeDate}
                  onChange={(e) => setActiveDate(e.target.value)}
                  className="px-3 py-2 border rounded-md text-sm"
                />
              )}
              <Button onClick={fetchActiveStats} disabled={loading}>
                조회
              </Button>
              <Button
                onClick={() => {
                  if (activeStats) {
                    downloadActiveEmployeesExcel(activeStats, activePeriod, activeDate);
                    toast.success("재직자 현황을 다운로드했습니다.");
                  }
                }}
                disabled={!activeStats}
                variant="outline"
                className="gap-2"
              >
                <Download size={16} />
                엑셀 다운로드
              </Button>
            </div>
          </div>
        </div>

        {/* 통계 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-blue-600">
                  {activeStats.total}
                </p>
                <p className="text-sm text-gray-500 mt-1">총 재직인원</p>
              </div>
            </CardContent>
          </Card>

          {orderedPositions(activeStats.byPosition).map((pos) => (
            <Card key={pos}>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-700">
                    {activeStats.byPosition[pos] || 0}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">{pos}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 지점별 상세 */}
        {Object.keys(activeStats.byBranch).length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">지점별 현황</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-semibold">
                        지점
                      </th>
                      <th className="text-center py-2 px-3">계</th>
                      {orderedPositions(activeStats.byPosition).map((pos) => (
                        <th key={pos} className="text-center py-2 px-3">{pos}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(activeStats.byBranch)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([branch, stats]) => (
                        <tr key={branch} className="border-b hover:bg-gray-50">
                          <td className="py-2 px-3">{branch}</td>
                          <td className="text-center py-2 px-3 font-semibold">
                            {stats.total}
                          </td>
                          {orderedPositions(activeStats.byPosition).map((pos) => (
                            <td key={pos} className="text-center py-2 px-3">
                              {stats[pos] || 0}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  };

  // 퇴직자 현황 카드 (연간)
  const renderResignedAnnual = () => {
    if (!resignedStatsAnnual) return null;

    return (
      <div className="space-y-6">
        {/* 기간 선택 */}
        <div className="flex items-end gap-4">
          <div className="space-y-2">
            <Label>년도</Label>
            <select
              value={resignedYear}
              onChange={(e) => setResignedYear(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm"
            >
              {Array.from({ length: 5 }, (_, i) => {
                const year = getYear(new Date()) - i;
                return (
                  <option key={year} value={year.toString()}>
                    {year}년
                  </option>
                );
              })}
            </select>
          </div>
          <Button onClick={fetchResignedAnnual} disabled={loading}>
            조회
          </Button>
          <Button
            onClick={() => {
              if (resignedStatsAnnual) {
                downloadResignedSummaryExcel(resignedStatsAnnual, resignedYear);
                toast.success("퇴직자 현황 요약을 다운로드했습니다.");
              }
            }}
            disabled={!resignedStatsAnnual}
            variant="outline"
            className="gap-2"
          >
            <Download size={16} />
            엑셀 다운로드
          </Button>
        </div>

        {/* 통계 */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-red-600">
                  {resignedStatsAnnual.total}
                </p>
                <p className="text-sm text-gray-500 mt-1">연간 퇴직자</p>
              </div>
            </CardContent>
          </Card>

          {orderedPositions(resignedStatsAnnual.byPosition).map((pos) => (
            <Card key={pos}>
              <CardContent className="pt-6">
                <div className="text-center">
                  <p className="text-2xl font-bold text-gray-700">
                    {resignedStatsAnnual.byPosition[pos] || 0}
                  </p>
                  <p className="text-sm text-gray-500 mt-1">{pos}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* 월별 퇴직자 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">월별 퇴직자</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(resignedStatsAnnual.byMonth)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([month, stats]) => {
                  const monthName = format(new Date(`${month}-01`), "M월");
                  return (
                    <div key={month} className="flex items-center gap-4">
                      <span className="w-16 text-sm font-medium">{monthName}</span>
                      <div className="flex-1 bg-gray-200 h-6 rounded-full overflow-hidden">
                        {stats.total > 0 && (
                          <div
                            className="bg-red-500 h-full flex items-center justify-center text-xs text-white font-semibold"
                            style={{
                              width: `${(stats.total / Math.max(...Object.values(resignedStatsAnnual.byMonth).map(s => s.total))) * 100}%`,
                            }}
                          >
                            {stats.total}명
                          </div>
                        )}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setResignedMonth(month);
                          setResignedPeriod("month");
                          fetchResignedMonthly();
                        }}
                      >
                        상세
                      </Button>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  };

  // 퇴직자 현황 카드 (월간)
  const renderResignedMonthly = () => {
    if (!resignedStatsMonthly) return null;

    return (
      <div className="space-y-6">
        {/* 기간 선택 */}
        <div className="flex items-end gap-4">
          <div className="space-y-2">
            <Label>월</Label>
            <input
              type="month"
              value={resignedMonth}
              onChange={(e) => setResignedMonth(e.target.value)}
              className="px-3 py-2 border rounded-md text-sm"
            />
          </div>
          <Button onClick={fetchResignedMonthly} disabled={loading}>
            조회
          </Button>
          <Button
            onClick={() => {
              if (resignedStatsMonthly) {
                downloadResignedEmployeesExcel(resignedStatsMonthly, "month", resignedMonth);
                toast.success("퇴직자 목록을 다운로드했습니다.");
              }
            }}
            disabled={!resignedStatsMonthly}
            variant="outline"
            className="gap-2"
          >
            <Download size={16} />
            엑셀 다운로드
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setResignedYear(resignedMonth.split("-")[0]);
              setResignedPeriod("year");
              fetchResignedAnnual();
            }}
          >
            연간 보기
          </Button>
        </div>

        {/* 퇴직자 목록 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {format(new Date(`${resignedMonth}-01`), "yyyy년 M월")} 퇴직자 ({resignedStatsMonthly.total}명)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {resignedStatsMonthly.total === 0 ? (
              <p className="text-gray-500 text-center py-8">퇴직자가 없습니다.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-semibold">
                        이름
                      </th>
                      <th className="text-left py-2 px-3">직급</th>
                      <th className="text-left py-2 px-3">지점</th>
                      <th className="text-center py-2 px-3">입사일</th>
                      <th className="text-center py-2 px-3">퇴사일</th>
                      <th className="text-left py-2 px-3">사유</th>
                      <th className="text-center py-2 px-3">작업</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resignedStatsMonthly.employees.map((emp) => (
                      <tr key={emp.id} className="border-b hover:bg-gray-50">
                        <td className="py-2 px-3 font-medium">{emp.name}</td>
                        <td className="py-2 px-3 text-gray-600">
                          {emp.position || "-"}
                        </td>
                        <td className="py-2 px-3 text-gray-600">
                          {emp.branch || "-"}
                        </td>
                        <td className="text-center py-2 px-3 text-gray-600">
                          {emp.hireDate
                            ? format(new Date(emp.hireDate), "yy.MM.dd")
                            : "-"}
                        </td>
                        <td className="text-center py-2 px-3 text-gray-600">
                          {emp.resignDate
                            ? format(new Date(emp.resignDate), "yy.MM.dd")
                            : "-"}
                        </td>
                        <td className="py-2 px-3 text-gray-600">
                          {emp.resignReason || "-"}
                        </td>
                        <td className="text-center py-2 px-3">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-red-600 hover:bg-red-50"
                            onClick={() => handleDeleteEmployee(emp)}
                            title="30일 보관 후 완전 삭제됩니다"
                          >
                            삭제
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">직원 현황</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          재직자 및 퇴직자 현황을 확인합니다
        </p>
      </div>

      <Tabs defaultValue="active" className="w-full">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="active">재직자 현황</TabsTrigger>
          <TabsTrigger value="resigned">퇴직자 현황</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-6">
          {renderActiveStats()}
        </TabsContent>

        <TabsContent value="resigned" className="mt-6">
          {resignedPeriod === "year"
            ? renderResignedAnnual()
            : renderResignedMonthly()}
        </TabsContent>
      </Tabs>

      {/* ═══ 직원 삭제 확인 모달 ═══ */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>직원 삭제</DialogTitle>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-4">
              <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                <p className="text-sm font-medium text-red-900 mb-2">⚠️ 주의</p>
                <p className="text-sm text-red-800 mb-3">
                  <strong>{deleteTarget.name}</strong> 직원을 삭제하시겠습니까?
                </p>
                <ul className="text-xs text-red-700 space-y-1 ml-4 list-disc">
                  <li>삭제된 직원은 30일 동안 보관됩니다</li>
                  <li>30일 후 자동으로 완전 삭제됩니다</li>
                  <li>삭제된 이메일로 새 직원을 등록할 수 있습니다</li>
                  <li>30일 이내에는 복구 가능합니다</li>
                </ul>
              </div>

              <div className="flex gap-2 justify-end pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDeleteConfirmOpen(false)}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={confirmDelete}
                >
                  삭제하기
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
