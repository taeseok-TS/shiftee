"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Users, Plus } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

type Employee = {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  position: string | null;
  phone: string | null;
  hireDate: string | null;
  leaveBalance: { remaining: number; used: number; total: number } | null;
};

const roleLabel: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  ADMIN: { label: "관리자", variant: "default" },
  MANAGER: { label: "매니저", variant: "secondary" },
  EMPLOYEE: { label: "직원", variant: "outline" },
};

export default function EmployeesPage() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [role, setRole] = useState("EMPLOYEE");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: "", email: "", password: "", role: "EMPLOYEE",
    department: "", position: "", phone: "", hireDate: "",
  });

  const fetchEmployees = useCallback(async () => {
    const res = await fetch("/api/employees");
    const data = await res.json();
    setEmployees(data.employees || []);
  }, []);

  useEffect(() => {
    fetchEmployees();
    fetch("/api/auth/me").then(r => r.json()).then(d => setRole(d.user?.role || "EMPLOYEE"));
  }, [fetchEmployees]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/employees", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error); return; }
    toast.success("직원이 등록되었습니다.");
    setOpen(false);
    setForm({ name: "", email: "", password: "", role: "EMPLOYEE", department: "", position: "", phone: "", hireDate: "" });
    fetchEmployees();
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">직원 관리</h1>
        {role !== "EMPLOYEE" && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus size={16} />직원 추가</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle>직원 추가</DialogTitle></DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>이름 *</Label>
                    <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>이메일 *</Label>
                    <Input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>비밀번호 *</Label>
                    <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>권한</Label>
                    <Select value={form.role} onValueChange={v => setForm(f => ({ ...f, role: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EMPLOYEE">직원</SelectItem>
                        <SelectItem value="MANAGER">매니저</SelectItem>
                        <SelectItem value="ADMIN">관리자</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>부서</Label>
                    <Input value={form.department} onChange={e => setForm(f => ({ ...f, department: e.target.value }))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>직책</Label>
                    <Input value={form.position} onChange={e => setForm(f => ({ ...f, position: e.target.value }))} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>연락처</Label>
                    <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="010-0000-0000" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>입사일</Label>
                    <Input type="date" value={form.hireDate} onChange={e => setForm(f => ({ ...f, hireDate: e.target.value }))} />
                  </div>
                </div>
                <div className="flex gap-2 justify-end pt-2">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>취소</Button>
                  <Button type="submit">등록</Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <div className="grid gap-4">
        {employees.map((emp) => {
          const r = roleLabel[emp.role] || { label: emp.role, variant: "outline" as const };
          return (
            <Card key={emp.id} className="hover:shadow-md transition-shadow">
              <CardContent className="pt-5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-11 h-11 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <span className="font-bold text-blue-700 text-lg">{emp.name[0]}</span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-gray-900">{emp.name}</p>
                        <Badge variant={r.variant} className="text-xs">{r.label}</Badge>
                      </div>
                      <p className="text-sm text-gray-500 mt-0.5">
                        {emp.department && <span>{emp.department}</span>}
                        {emp.department && emp.position && <span> · </span>}
                        {emp.position && <span>{emp.position}</span>}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{emp.email}</p>
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    {emp.leaveBalance && (
                      <div className="text-sm">
                        <span className="text-gray-500">연차 잔여 </span>
                        <span className="font-semibold text-blue-600">{emp.leaveBalance.remaining}일</span>
                        <span className="text-gray-400"> / {emp.leaveBalance.total}일</span>
                      </div>
                    )}
                    {emp.hireDate && (
                      <p className="text-xs text-gray-400">
                        입사일: {format(new Date(emp.hireDate), "yyyy.MM.dd")}
                      </p>
                    )}
                    {emp.phone && (
                      <p className="text-xs text-gray-400">{emp.phone}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
