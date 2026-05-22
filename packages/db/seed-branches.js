const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const branches = [
  { name: "서울강남점" },
  { name: "서울강북점" },
  { name: "부산중앙점" },
  { name: "인천연수점" },
  { name: "대구중앙점" },
  { name: "대전유성점" },
  { name: "광주동구점" },
  { name: "울산중구점" },
  { name: "경기수원점" },
  { name: "경기안산점" },
  { name: "강원춘천점" },
  { name: "충북청주점" },
  { name: "전북전주점" },
  { name: "경주점" },
  { name: "제주점" }
];

async function main() {
  console.log("🌱 데이터베이스에 지점 추가 중...\n");
  
  for (const branch of branches) {
    const existing = await prisma.branch.findUnique({
      where: { name: branch.name }
    });
    
    if (existing) {
      console.log(`✅ 이미 존재: ${branch.name}`);
    } else {
      await prisma.branch.create({
        data: {
          name: branch.name,
          radius: 100,
          isActive: true,
        }
      });
      console.log(`✨ 생성: ${branch.name}`);
    }
  }
  
  console.log("\n✅ 지점 데이터 추가 완료!");
  
  const all = await prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  console.log(`\n📊 총 ${all.length}개 지점:`);
  all.forEach(b => console.log(`  - ${b.name}`));
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
