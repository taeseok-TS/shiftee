require('dotenv').config({ path: '.env.local' });
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  // 지점 데이터 추가
  const branches = await Promise.all([
    prisma.branch.create({
      data: {
        name: '본사',
        address: '서울시 강남구',
        latitude: 37.4979,
        longitude: 127.0276,
        radius: 200,
      },
    }),
    prisma.branch.create({
      data: {
        name: '서울강남점',
        address: '서울시 강남구 테헤란로',
        latitude: 37.4980,
        longitude: 127.0277,
        radius: 150,
      },
    }),
    prisma.branch.create({
      data: {
        name: '서울강북점',
        address: '서울시 강북구',
        latitude: 37.6269,
        longitude: 127.0288,
        radius: 150,
      },
    }),
    prisma.branch.create({
      data: {
        name: '부산점',
        address: '부산시 해운대구',
        latitude: 35.1620,
        longitude: 129.1605,
        radius: 150,
      },
    }),
  ]);

  console.log(`✅ Created ${branches.length} branches`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
