"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { UmbrellaOff, Plus, Check, X } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";

type LeaveRequest = {
  id: string;
  type: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  user: { name: string; department: string | null };
  approver: { name: string } | null;
};

const typeLabel: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차", SICK: "병가", SPECIAL: "특별휴가",
};
const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  PENDING: { label: "대기중", variant: "secondary" },
  APPROVED: { label: "승인", variant: "default" },
  REJECTED: { label: "반려", variant: "destructive" },
  CANCELLED: { label: "취소", variant: "outline" },
};

export default function LeavePage() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<string>("EMPLOYEE");
  const [form, setForm] = useState({ type: "ANNUAL", startDate: "", endDate: "", reason: "" });

  const fetchRequests = useCallback(async () => {
    const res = await fetch("/api/leave");
    const data = await res.json();
    setRequests(data.requests || []);
  }, []);

  useEffect(() => {
    fetchRequests();
    fetch("/api/auth/me").then(r => r.json()).then(d => setRole(d.user?.role || "EMPLOYEE"));
  }, [fetchRequests]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("휴가 신청이 완료되었습니다.");
    setOpen(false);
    setForm({ type: "ANNUAL", startDate: "", endDate: "", reason: "" });
    fetchRequests();
  }

  async function handleApprove(id: string, action: "approve" | "reject") {
    const res = await fetch(`/api/leave/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success(action === "approve" ? "승인되었습니다." : "반려되었습니다.");
    fetchRequests();
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">휴가 관리</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><Plus size={16} />휴가 신청</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>휴가 신청</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>휴가 유형</Label>
                <Select value={form.type} onValueChange={(v) => setForm(f => ({ ...f, type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(typeLabel).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>시작일</Label>
                  <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} required />
                </div>
                <div className="space-y-2">
                  <Label>종료일</Label>
                  <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} required />
                </div>
              </div>
              <div className="space-y-2">
                <Label>사유 (선택)</Label>
                <Textarea value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} placeholder="휴가 사유를 입력하세요" rows={3} />
              </div>
              <div className="flex gap-2 justify-end">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>취소</Button>
                <Button type="submit">신청</Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UmbrellaOff size={18} />
            휴가 신청 목록
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  {role !== "EMPLOYEE" && <th className="pb-3 font-medium">직원</th>}
                  <th className="pb-3 font-medium">유형</th>
                  <th className="pb-3 font-medium">기간</th>
                  <th className="pb-3 font-medium">일수</th>
                  <th className="pb-3 font-medium">사유</th>
                  <th className="pb-3 font-medium">상태</th>
                  {role !== "EMPLOYEE" && <th className="pb-3 font-medium">처리</th>}
                </tr>
              </thead>
              <tbody>
                {requests.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">신청 내역이 없습니다.</td></tr>
                ) : requests.map((r) => {
                  const s = statusConfig[r.status] || { label: r.status, variant: "outline" as const };
                  return (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                      {role !== "EMPLOYEE" && (
                        <td className="py-3">
                          <p className="font-medium">{r.user.name}</p>
                          <p className="text-xs text-gray-400">{r.user.department}</p>
                        </td>
                      )}
                      <td className="py-3">{typeLabel[r.type] || r.type}</td>
                      <td className="py-3">
                        {format(new Date(r.startDate), "MM/dd")} ~ {format(new Date(r.endDate), "MM/dd", { locale: ko })}
                      </td>
                      <td className="py-3">{r.days}일</td>
                      <td className="py-3 max-w-[160px] truncate text-gray-500">{r.reason || "-"}</td>
                      <td className="py-3"><Badge variant={s.variant}>{s.label}</Badge></td>
                      {role !== "EMPLOYEE" && (
                        <td className="py-3">
                          {r.status === "PENDING" && (
                            <div className="flex gap-1">
                              <Button size="sm" className="h-7 gap-1 bg-green-600 hover:bg-green-700" onClick={() => handleApprove(r.id, "approve")}>
                                <Check size={12} />승인
                              </Button>
                              <Button size="sm" variant="destructive" className="h-7 gap-1" onClick={() => handleApprove(r.id, "reject")}>
                                <X size={12} />반려
                              </Button>
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
