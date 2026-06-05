const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

(async () => {
  try {
    // 해시된 비밀번호 생성
    const hashedPassword = await bcrypt.hash("test1234", 10);

    const testUser = await prisma.user.create({
      data: {
        email: "testemployee@example.com",
        password: hashedPassword,
        name: "테스트직원",
        role: "EMPLOYEE",
        isActive: true,
        branch: "A지점"
      }
    });

    console.log("✅ 테스트 직원 계정 생성 완료!");
    console.log("=== 로그인 정보 ===");
    console.log("이메일: testemployee@example.com");
    console.log("비밀번호: test1234");
    console.log("이름: 테스트직원");
    console.log("직급: EMPLOYEE");
    console.log("===================");

  } catch (error) {
    console.error("❌ 에러:", error.message);
    console.error("전체 에러:", error);
  } finally {
    await prisma.$disconnect();
  }
})();
