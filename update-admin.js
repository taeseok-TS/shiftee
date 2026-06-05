// 현재 로그인된 사용자를 ADMIN으로 승격하는 스크립트
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('=== 사용자를 ADMIN으로 승격 ===\n');

  // "관리자"라는 이름의 사용자 찾기
  const user = await prisma.user.findFirst({
    where: { name: '관리자' }
  });

  if (!user) {
    console.log('❌ "관리자"라는 이름의 사용자를 찾을 수 없습니다.');
    console.log('\n현재 데이터베이스의 사용자 목록:');
    const allUsers = await prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true }
    });
    allUsers.forEach(u => {
      console.log(`  - ${u.name} (${u.email}) : ${u.role}`);
    });
  } else {
    console.log(`✓ 사용자 발견: ${user.name}`);
    console.log(`  - 현재 권한: ${user.role}`);
    console.log('');

    // ADMIN으로 업데이트
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' }
    });

    console.log(`✓ 권한 변경 완료!`);
    console.log(`  - 새로운 권한: ${updated.role}`);
    console.log('');
    console.log('🔄 다음 단계:');
    console.log('1️⃣  브라우저를 새로고침하세요 (F5 또는 Ctrl+R)');
    console.log('2️⃣  주소창에 localhost:3000/admin/employees 입력');
    console.log('3️⃣  관리자 페이지가 보여야 합니다!');
  }

  await prisma.$disconnect();
}

main().catch(e => {
  console.error('❌ 에러:', e);
  process.exit(1);
});
