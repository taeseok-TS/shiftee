import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 데이터베이스 시드 시작...\n");

  // 1. 기본 사용자 생성
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@test.com" },
    update: {},
    create: {
      email: "admin@test.com",
      password: await bcrypt.hash("password123", 10),
      name: "관리자",
      role: "ADMIN",
      phone: "010-0000-0001",
      branch: "본사",
      department: "관리",
      jobGroup: "관리자",
      position: "시스템관리자",
    },
  });

  const managerUser = await prisma.user.upsert({
    where: { email: "manager@test.com" },
    update: {},
    create: {
      email: "manager@test.com",
      password: await bcrypt.hash("password123", 10),
      name: "원장",
      role: "MANAGER",
      phone: "010-0000-0002",
      branch: "A지점",
      department: "운영",
      jobGroup: "원장",
      position: "원장",
    },
  });

  // 2. 지점 생성
  console.log("📍 지점 생성 중...");
  const branches = [];
  for (let i = 1; i <= 3; i++) {
    const branch = await prisma.branch.create({
      data: {
        name: `${String.fromCharCode(64 + i)}지점`,
        address: `주소 ${i}`,
        latitude: 37.4979 + i * 0.01,
        longitude: 127.0276 + i * 0.01,
        radius: 100,
      },
    }).catch(() => null);
    if (branch) branches.push(branch);
  }
  console.log(`✅ 지점 ${branches.length}개 생성`);

  // 3. 직원 생성 (50명)
  console.log("👥 직원 생성 중...");
  const employees = [];
  for (let i = 1; i <= 50; i++) {
    const emp = await prisma.user.create({
      data: {
        email: `emp${i}@test.com`,
        password: await bcrypt.hash("password123", 10),
        name: `직원${i}`,
        role: "EMPLOYEE",
        phone: `010-${String(i).padStart(4, "0")}-1111`,
        branch: branches[i % branches.length]?.name || "A지점",
        department: ["운영", "교육", "행정"][i % 3],
        jobGroup: ["TM", "CM", "관리"][i % 3],
        position: ["교실장", "코디", "매니저"][i % 3],
      },
    });
    employees.push(emp);

    // 휴가 잔여일
    await prisma.leaveBalance.create({
      data: {
        userId: emp.id,
        year: 2026,
        total: 15,
        used: i % 5,
        remaining: 15 - (i % 5),
      },
    });
  }
  console.log("✅ 직원 50명 생성");

  // 4. 결재라인 설정 (모든 직원)
  console.log("📋 결재라인 설정 중...");
  for (const emp of employees) {
    await prisma.approvalLine.upsert({
      where: { userId: emp.id },
      update: {},
      create: {
        userId: emp.id,
        steps: {
          create: [
            { order: 1, approverId: managerUser.id },
            { order: 2, approverId: adminUser.id },
          ],
        },
      },
    }).catch(() => null);
  }
  console.log("✅ 결재라인 설정 완료");

  // 5. 계약서 템플릿
  console.log("📄 계약서 템플릿 생성 중...");
  const template = await prisma.contractTemplate.upsert({
    where: { name: "기본 근로 계약서" },
    update: {},
    create: {
      name: "기본 근로 계약서",
      type: "EMPLOYMENT",
      description: "기본 근로 계약서 템플릿",
      fileUrl: "/templates/default.docx",
      createdBy: adminUser.id,
      isActive: true,
    },
  });
  console.log("✅ 템플릿 1개 생성");

  // 6. 휴가 요청 (20개)
  console.log("🏖️ 휴가 요청 생성 중...");
  for (let i = 0; i < 20; i++) {
    await prisma.leaveRequest.create({
      data: {
        userId: employees[i % employees.length].id,
        startDate: new Date(2026, 5, 10 + i),
        endDate: new Date(2026, 5, 12 + i),
        days: 2,
        type: i % 2 === 0 ? "ANNUAL" : "SICK",
        status: ["PENDING", "APPROVED", "REJECTED"][i % 3] as any,
        reason: `휴가 요청 ${i + 1}`,
        approverId: managerUser.id,
      },
    }).catch(() => null);
  }
  console.log("✅ 휴가 요청 20개 생성");

  // 7. 계약서 (20개)
  console.log("📑 계약서 생성 중...");
  for (let i = 0; i < 20; i++) {
    await prisma.contract.create({
      data: {
        userId: employees[i % employees.length].id,
        templateId: template.id,
        title: `근로 계약서 ${i + 1}`,
        type: "EMPLOYMENT",
        fileUrl: `/contracts/contract-${i + 1}.pdf`,
        status: ["DRAFT", "SIGNED", "REJECTED"][i % 3] as any,
      },
    }).catch(() => null);
  }
  console.log("✅ 계약서 20개 생성");

  // 8. 근무일정 요청 (10개)
  console.log("📅 근무일정 요청 생성 중...");
  for (let i = 0; i < 10; i++) {
    await prisma.scheduleRequest.create({
      data: {
        userId: employees[i % employees.length].id,
        templateName: ["10-7", "9-6", "11-8"][i % 3],
        templateId: ["10-7", "9-6", "11-8"][i % 3],
        startDate: new Date(2026, 6, 1 + i * 2),
        endDate: new Date(2026, 6, 5 + i * 2),
        scheduleData: [
          { date: `2026-0${7}-${String(1 + i * 2).padStart(2, "0")}`, startTime: "09:00", endTime: "18:00" },
        ],
        totalHours: 36,
        status: "PENDING",
      },
    }).catch(() => null);
  }
  console.log("✅ 근무일정 요청 10개 생성");

  // 9. 출퇴근 기록 (100개)
  console.log("🕐 출퇴근 기록 생성 중...");
  for (let i = 0; i < 100; i++) {
    const date = new Date();
    date.setDate(date.getDate() - (i % 30));

    await prisma.attendance.create({
      data: {
        userId: employees[i % employees.length].id,
        date,
        clockIn: new Date(date.setHours(9, Math.floor(Math.random() * 30))),
        clockOut: new Date(date.setHours(18, Math.floor(Math.random() * 30))),
        status: "NORMAL",
      },
    }).catch(() => null);
  }
  console.log("✅ 출퇴근 기록 100개 생성");

  console.log("\n🎉 데이터베이스 시드 완료!\n");
  console.log("📝 테스트 계정:");
  console.log("─────────────────────────────");
  console.log("관리자: admin@test.com / password123");
  console.log("원장: manager@test.com / password123");
  console.log("직원: emp1@test.com ~ emp50@test.com / password123");
  console.log("─────────────────────────────");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error("❌ 시드 실패:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
