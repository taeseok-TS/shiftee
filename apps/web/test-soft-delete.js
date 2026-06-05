const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

(async () => {
  try {
    // 테스트 직원 조회
    const testUser = await prisma.user.findUnique({
      where: { email: "testemployee@example.com" }
    });

    console.log("=== 현재 테스트 직원 상태 ===");
    console.log("ID:", testUser.id);
    console.log("이름:", testUser.name);
    console.log("이메일:", testUser.email);
    console.log("isActive:", testUser.isActive);
    console.log("deletedAt:", testUser.deletedAt);
    console.log("permanentlyDeletedAt:", testUser.permanentlyDeletedAt);
    console.log("");

    // Soft Delete 테스트: deletedAt 설정
    const deletedUser = await prisma.user.update({
      where: { id: testUser.id },
      data: {
        deletedAt: new Date(),
        isActive: false
      }
    });

    console.log("=== Soft Delete 후 상태 ===");
    console.log("isActive:", deletedUser.isActive);
    console.log("deletedAt:", deletedUser.deletedAt);
    console.log("");

    // Soft Delete 복구 테스트
    const restoredUser = await prisma.user.update({
      where: { id: testUser.id },
      data: {
        deletedAt: null,
        isActive: true
      }
    });

    console.log("=== Soft Delete 복구 후 상태 ===");
    console.log("isActive:", restoredUser.isActive);
    console.log("deletedAt:", restoredUser.deletedAt);

  } catch (error) {
    console.error("❌ 에러:", error.message);
  } finally {
    await prisma.$disconnect();
  }
})();
