import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { subDays, isWeekend, setHours, setMinutes } from "date-fns";

// 개발용 시드 API (운영 시 제거)
export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "운영 환경에서는 사용할 수 없습니다." }, { status: 403 });
  }

  let admin = await prisma.user.findUnique({ where: { email: "admin@shiftee.com" } });

  if (!admin) {
    const hashedPassword = await bcrypt.hash("admin1234", 10);
    admin = await prisma.user.create({
      data: {
        email: "admin@shiftee.com",
        password: hashedPassword,
        name: "관리자",
        role: "ADMIN",
        department: "경영",
        position: "대표",
        hireDate: new Date("2020-01-01"),
      },
    });

    // 직원 계정 2개
    const employees = await Promise.all([
      prisma.user.create({
        data: {
          email: "kim@shiftee.com",
          password: await bcrypt.hash("1234", 10),
          name: "김민준",
          role: "EMPLOYEE",
          department: "개발팀",
          position: "개발자",
          hireDate: new Date("2023-03-01"),
        },
      }),
      prisma.user.create({
        data: {
          email: "lee@shiftee.com",
          password: await bcrypt.hash("1234", 10),
          name: "이서연",
          role: "EMPLOYEE",
          department: "디자인팀",
          position: "디자이너",
          hireDate: new Date("2024-01-15"),
        },
      }),
    ]);

    // 직원 휴가 잔여 초기화
    await Promise.all(employees.map(emp =>
      prisma.leaveBalance.create({
        data: { userId: emp.id, year: new Date().getFullYear(), total: 15, used: 0, remaining: 15 },
      })
    ));
  }

  // 출퇴근 샘플 데이터 추가 (없을 경우)
  const existingAttendance = await prisma.attendance.count();
  if (existingAttendance === 0) {
    const allUsers = await prisma.user.findMany({ where: { isActive: true } });
    const today = new Date();
    const attendanceData = [];

    for (const user of allUsers) {
      for (let i = 60; i >= 1; i--) {
        const date = subDays(today, i);
        if (isWeekend(date)) continue;

        // 랜덤 출퇴근 패턴 생성
        const rand = Math.random();
        let status: "NORMAL" | "LATE" | "EARLY_LEAVE" | "ABSENT";
        let clockIn: Date | null = null;
        let clockOut: Date | null = null;

        if (rand < 0.05) {
          // 5% 결근
          status = "ABSENT";
        } else if (rand < 0.15) {
          // 10% 지각 (9:10~9:40)
          status = "LATE";
          const inMin = 10 + Math.floor(Math.random() * 30);
          clockIn = setMinutes(setHours(new Date(date), 9), inMin);
          clockOut = setMinutes(setHours(new Date(date), 17 + Math.floor(Math.random() * 2)), Math.floor(Math.random() * 60));
        } else if (rand < 0.22) {
          // 7% 조퇴 (14~16시 퇴근)
          status = "EARLY_LEAVE";
          const inMin = Math.floor(Math.random() * 10);
          clockIn = setMinutes(setHours(new Date(date), 9), inMin);
          clockOut = setMinutes(setHours(new Date(date), 14 + Math.floor(Math.random() * 2)), Math.floor(Math.random() * 60));
        } else {
          // 78% 정상
          status = "NORMAL";
          const inMin = Math.floor(Math.random() * 10); // 9:00~9:09
          clockIn = setMinutes(setHours(new Date(date), 9), inMin);
          const outHour = 18 + Math.floor(Math.random() * 2); // 18~19시
          clockOut = setMinutes(setHours(new Date(date), outHour), Math.floor(Math.random() * 60));
        }

        attendanceData.push({
          userId: user.id,
          date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
          clockIn,
          clockOut,
          status,
        });
      }
    }

    await prisma.attendance.createMany({ data: attendanceData, skipDuplicates: true });

    // 휴가 신청 샘플 데이터
    const employees = await prisma.user.findMany({ where: { role: "EMPLOYEE" } });
    if (employees.length > 0) {
      await prisma.leaveRequest.createMany({
        data: [
          {
            userId: employees[0].id,
            type: "ANNUAL",
            startDate: subDays(today, 20),
            endDate: subDays(today, 20),
            days: 1,
            reason: "개인 사유",
            status: "APPROVED",
            approvedAt: subDays(today, 21),
          },
          {
            userId: employees[0].id,
            type: "HALF_AM",
            startDate: subDays(today, 10),
            endDate: subDays(today, 10),
            days: 0.5,
            reason: "병원 방문",
            status: "APPROVED",
            approvedAt: subDays(today, 11),
          },
          {
            userId: employees.length > 1 ? employees[1].id : employees[0].id,
            type: "ANNUAL",
            startDate: subDays(today, 5),
            endDate: subDays(today, 3),
            days: 3,
            reason: "여행",
            status: "PENDING",
          },
        ],
        skipDuplicates: true,
      });
    }
  }

  return NextResponse.json({
    message: "시드 데이터가 준비되었습니다.",
    accounts: [
      { role: "관리자", email: "admin@shiftee.com", password: "admin1234" },
      { role: "직원", email: "kim@shiftee.com", password: "1234" },
      { role: "직원", email: "lee@shiftee.com", password: "1234" },
    ],
  });
}
