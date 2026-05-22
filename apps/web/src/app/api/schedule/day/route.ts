import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { format, startOfDay, endOfDay } from "date-fns";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const dateStr = searchParams.get("date");
  if (!dateStr) return NextResponse.json({ error: "날짜가 필요합니다." }, { status: 400 });

  const date    = new Date(dateStr);
  const dayStart = startOfDay(date);
  const dayEnd   = endOfDay(date);

  const branchWhere = session.role === "MANAGER" ? { branch: session.branch } : {};

  const [employees, schedules, attendances, leaves] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, ...branchWhere },
      select: { id: true, name: true, department: true, position: true },
      orderBy: [{ department: "asc" }, { name: "asc" }],
    }),
    prisma.schedule.findMany({
      where: { date: { gte: dayStart, lte: dayEnd } },
      select: { id: true, userId: true, type: true, startTime: true, endTime: true, note: true },
    }),
    prisma.attendance.findMany({
      where: { date: { gte: dayStart, lte: dayEnd } },
      select: { id: true, userId: true, clockIn: true, clockOut: true, status: true },
    }),
    prisma.leaveRequest.findMany({
      where: {
        status: "APPROVED",
        startDate: { lte: dayEnd },
        endDate: { gte: dayStart },
      },
      select: { id: true, userId: true, type: true },
    }),
  ]);

  const schedMap = new Map(schedules.map(s  => [s.userId, s]));
  const attMap   = new Map(attendances.map(a => [a.userId, a]));
  const leaveMap = new Map(leaves.map(l     => [l.userId, l]));

  const result = employees.map(emp => {
    const sched = schedMap.get(emp.id) ?? null;
    const att   = attMap.get(emp.id)   ?? null;
    const leave = leaveMap.get(emp.id) ?? null;

    // 종합 상태 결정
    let status: string;
    if (leave)                           status = "LEAVE";
    else if (!sched)                     status = "NO_SCHEDULE";
    else if (sched.type === "OFF")       status = "OFF";
    else if (sched.type === "HOLIDAY")   status = "HOLIDAY";
    else if (att)                        status = att.status;          // NORMAL/LATE/EARLY_LEAVE/ABSENT
    else                                 status = "NOT_YET";           // 근무 예정이나 미입력

    return {
      id:          emp.id,
      name:        emp.name,
      department:  emp.department ?? "-",
      position:    emp.position   ?? "-",
      scheduleId:  sched?.id      ?? null,
      scheduleType: sched?.type   ?? null,
      startTime:   sched?.startTime ?? null,
      endTime:     sched?.endTime   ?? null,
      note:        sched?.note      ?? null,
      clockIn:     att?.clockIn  ? format(new Date(att.clockIn),  "HH:mm") : null,
      clockOut:    att?.clockOut ? format(new Date(att.clockOut), "HH:mm") : null,
      leaveType:   leave?.type   ?? null,
      status,
    };
  });

  // 요약 집계
  const summary = {
    total:       result.length,
    checkedIn:   result.filter(r => ["NORMAL","LATE","EARLY_LEAVE"].includes(r.status)).length,
    late:        result.filter(r => r.status === "LATE").length,
    earlyLeave:  result.filter(r => r.status === "EARLY_LEAVE").length,
    absent:      result.filter(r => r.status === "ABSENT").length,
    leave:       result.filter(r => r.status === "LEAVE").length,
    notYet:      result.filter(r => r.status === "NOT_YET").length,
    off:         result.filter(r => ["OFF","NO_SCHEDULE"].includes(r.status)).length,
  };

  return NextResponse.json({ date: dateStr, employees: result, summary });
}
