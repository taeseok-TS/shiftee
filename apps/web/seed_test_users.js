require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = bcrypt.hashSync('password123', 10);
  
  // Manager 계정
  await prisma.user.create({
    data: {
      email: 'manager@example.com',
      password: hashedPassword,
      name: '매니저',
      role: 'MANAGER',
      jobGroup: 'CM',
      branch: '서울강남점',
      hireDate: new Date('2022-01-01'),
      employmentStatus: 'ACTIVE',
    },
  });

  // Employee 계정
  await prisma.user.create({
    data: {
      email: 'employee3@example.com',
      password: hashedPassword,
      name: '일반직원',
      role: 'EMPLOYEE',
      jobGroup: '코디',
      branch: '부산점',
      hireDate: new Date('2024-01-01'),
      employmentStatus: 'ACTIVE',
    },
  });

  console.log('✅ 테스트 계정 생성 완료');
}

main().catch((e) => {
  console.error('❌ Error:', e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});
