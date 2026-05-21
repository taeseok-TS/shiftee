"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { FileSignature, Plus, PenLine } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Contract = {
  id: string;
  title: string;
  type: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  signedAt: string | null;
  createdAt: string;
  user: { name: string; department: string | null };
};

type Employee = { id: string; name: string; department: string | null };

const typeLabel: Record<string, string> = {
  EMPLOYMENT: "근로계약서",
  PART_TIME: "단시간근로계약서",
  CONFIDENTIAL: "비밀유지계약",
  OTHER: "기타",
};

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; color: string }> = {
  DRAFT: { label: "초안", variant: "outline", color: "text-gray-500" },
  SENT: { label: "서명 대기", variant: "secondary", color: "text-orange-600" },
  SIGNED: { label: "서명 완료", variant: "default", color: "text-green-600" },
  EXPIRED: { label: "만료", variant: "destructive", color: "text-red-500" },
};

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [role, setRole] = useState("EMPLOYEE");
  const [myId, setMyId] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "" });

  const fetchContracts = useCallback(async () => {
    const res = await fetch("/api/contracts");
    const data = await res.json();
    setContracts(data.contracts || []);
  }, []);

  useEffect(() => {
    fetchContracts();
    fetch("/api/auth/me").then(r => r.json()).then(d => {
      setRole(d.user?.role || "EMPLOYEE");
      setMyId(d.user?.id || "");
    });
    fetch("/api/employees").then(r => r.json()).then(d => setEmployees(d.employees || [])).catch(() => {});
  }, [fetchContracts]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/contracts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("계약서가 발송되었습니다.");
    setOpen(false);
    setForm({ userId: "", title: "", type: "EMPLOYMENT", startDate: "", endDate: "" });
    fetchContracts();
  }

  async function handleSign(id: string) {
    const res = await fetch(`/api/contracts/${id}/sign`, { method: "POST" });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("계약서에 서명하였습니다.");
    fetchContracts();
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">전자계약</h1>
        {role !== "EMPLOYEE" && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus size={16} />계약서 발송</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>계약서 발송</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>대상 직원 *</Label>
                  <Select value={form.userId} onValueChange={v => setForm(f => ({ ...f, userId: v }))}>
                    <SelectTrigger><SelectValue placeholder="직원 선택" /></SelectTrigger>
                    <SelectContent>
                      {employees.map(emp => (
                        <SelectItem key={emp.id} value={emp.id}>{emp.name} ({emp.department || "부서 없음"})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>계약서 제목 *</Label>
                  <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="예: 2026년 근로계약서" required />
                </div>
                <div className="space-y-2">
                  <Label>계약 유형 *</Label>
                  <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
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
                    <Label>계약 시작일</Label>
                    <Input type="date" value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                  </div>
                  <div className="space-y-2">
                    <Label>계약 종료일</Label>
                    <Input type="date" value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2 justify-end">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>취소</Button>
                  <Button type="submit">발송</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* 서명 대기 중인 계약서 (직원에게만 강조 표시) */}
      {role === "EMPLOYEE" && contracts.filter(c => c.status === "SENT").length > 0 && (
        <Card className="border-orange-200 bg-orange-50">
          <CardHeader>
            <CardTitle className="text-base text-orange-700 flex items-center gap-2">
              <PenLine size={18} />
              서명이 필요한 계약서
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {contracts.filter(c => c.status === "SENT").map(c => (
                <div key={c.id} className="flex items-center justify-between bg-white rounded-lg p-3 border border-orange-200">
                  <div>
                    <p className="font-medium text-sm">{c.title}</p>
                    <p className="text-xs text-gray-500">{typeLabel[c.type]} · 발송일: {format(new Date(c.createdAt), "yyyy.MM.dd")}</p>
                  </div>
                  <Button size="sm" onClick={() => handleSign(c.id)} className="gap-1.5">
                    <PenLine size={14} />서명하기
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* 전체 계약서 목록 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileSignature size={18} />
            계약서 목록
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  {role !== "EMPLOYEE" && <th className="pb-3 font-medium">직원</th>}
                  <th className="pb-3 font-medium">제목</th>
                  <th className="pb-3 font-medium">유형</th>
                  <th className="pb-3 font-medium">계약기간</th>
                  <th className="pb-3 font-medium">상태</th>
                  <th className="pb-3 font-medium">서명일</th>
                  {role === "EMPLOYEE" && <th className="pb-3 font-medium">처리</th>}
                </tr>
              </thead>
              <tbody>
                {contracts.length === 0 ? (
                  <tr><td colSpan={7} className="py-8 text-center text-gray-400">계약서가 없습니다.</td></tr>
                ) : contracts.map((c) => {
                  const s = statusConfig[c.status] || { label: c.status, variant: "outline" as const, color: "" };
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50">
                      {role !== "EMPLOYEE" && (
                        <td className="py-3">
                          <p className="font-medium">{c.user.name}</p>
                          <p className="text-xs text-gray-400">{c.user.department}</p>
                        </td>
                      )}
                      <td className="py-3 font-medium">{c.title}</td>
                      <td className="py-3 text-gray-600">{typeLabel[c.type] || c.type}</td>
                      <td className="py-3 text-gray-600">
                        {c.startDate && c.endDate
                          ? `${format(new Date(c.startDate), "yyyy.MM.dd")} ~ ${format(new Date(c.endDate), "yyyy.MM.dd")}`
                          : "-"}
                      </td>
                      <td className="py-3">
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </td>
                      <td className="py-3 text-gray-600">
                        {c.signedAt ? format(new Date(c.signedAt), "yyyy.MM.dd") : "-"}
                      </td>
                      {role === "EMPLOYEE" && (
                        <td className="py-3">
                          {c.status === "SENT" && (
                            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => handleSign(c.id)}>
                              <PenLine size={12} />서명
                            </Button>
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
