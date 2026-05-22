const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const branchMapping = {
  "A": "서울강남점",
  "B": "서울강북점",
  "C": "부산중앙점",
  "D": "인천연수점",
  "E": "대구중앙점",
  "F": "대전유성점",
  "G": "광주동구점",
  "H": "울산중구점",
  "I": "경기수원점",
  "J": "경기안산점",
  "K": "강원춘천점",
  "L": "충북청주점",
  "M": "전북전주점",
  "N": "경주점",
  "O": "제주점"
};

function normalizeBranch(branch) {
  if (!branch) return null;
  
  // 이미 실제 지점명
  if (Object.values(branchMapping).includes(branch)) {
    return branch;
  }
  
  // A지점 형식
  if (branch.endsWith("지점")) {
    const letter = branch.slice(0, -2);
    return branchMapping[letter] || null;
  }
  
  // A, B, C 형식
  return branchMapping[branch.toUpperCase()] || null;
}

async function main() {
  console.log("🔄 직원 지점명 마이그레이션 시작...\n");
  
  const employees = await prisma.user.findMany({
    where: { branch: { not: null } },
    select: { id: true, name: true, branch: true }
  });
  
  console.log(`📊 총 ${employees.length}명의 직원 처리 중...\n`);
  
  let updated = 0;
  let skipped = 0;
  
  for (const emp of employees) {
    const normalized = normalizeBranch(emp.branch);
    
    if (normalized === emp.branch) {
      skipped++;
      console.log(`✅ 이미 정규화됨: ${emp.name} (${emp.branch})`);
    } else if (normalized) {
      await prisma.user.update({
        where: { id: emp.id },
        data: { branch: normalized }
      });
      updated++;
      console.log(`✨ 업데이트: ${emp.name} (${emp.branch} → ${normalized})`);
    } else {
      skipped++;
      console.log(`⚠️  정규화 실패: ${emp.name} (${emp.branch})`);
    }
  }
  
  console.log(`\n✅ 마이그레이션 완료!`);
  console.log(`   - 업데이트됨: ${updated}명`);
  console.log(`   - 이미 정규화됨/실패: ${skipped}명`);
  
  // 최종 확인
  const result = await prisma.user.findMany({
    where: { branch: { not: null } },
    select: { branch: true },
    distinct: ['branch']
  });
  
  console.log(`\n📍 현재 지점 목록 (${result.length}개):`);
  result.map(r => r.branch).sort().forEach(b => console.log(`  - ${b}`));
}

main()
  .then(() => process.exit(0))
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
