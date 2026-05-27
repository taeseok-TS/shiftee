const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = bcrypt.hashSync('password123', 10);
  
  // Admin 사용자
  await prisma.user.create({
    data: {
      email: 'admin@example.com',
      password: hashedPassword,
      name: '관리자',
      role: 'ADMIN',
      jobGroup: '원장',
      branch: '본사',
      hireDate: new Date('2020-01-01'),
      employmentStatus: 'ACTIVE',
    },
  });

  // 직원1
  await prisma.user.create({
    data: {
      email: 'employee1@example.com',
      password: hashedPassword,
      name: '김철수',
      role: 'EMPLOYEE',
      jobGroup: 'CM',
      branch: '서울강남점',
      hireDate: new Date('2023-03-15'),
      employmentStatus: 'ACTIVE',
    },
  });

  // 직원2
  await prisma.user.create({
    data: {
      email: 'employee2@example.com',
      password: hashedPassword,
      name: '이영희',
      role: 'EMPLOYEE',
      jobGroup: 'TM',
      branch: '서울강남점',
      hireDate: new Date('2023-06-01'),
      employmentStatus: 'ACTIVE',
    },
  });

  // 퇴사자
  await prisma.user.create({
    data: {
      email: 'resigned@example.com',
      password: hashedPassword,
      name: '박영수',
      role: 'EMPLOYEE',
      jobGroup: 'TM',
      branch: '서울강남점',
      hireDate: new Date('2022-01-10'),
      resignDate: new Date('2026-05-15'),
      resignReason: '개인사유',
      employmentStatus: 'RESIGNED',
      isActive: false,
    },
  });

  console.log('Seed data created successfully');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
