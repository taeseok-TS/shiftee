const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  try {
    const hashedPassword = await bcrypt.hash("password123", 10);
    
    const user = await prisma.user.create({
      data: {
        email: "admin@example.com",
        password: hashedPassword,
        name: "관리자",
        role: "ADMIN",
        department: "인사팀",
        position: "부장",
        branch: "서울강남점",
        isActive: true,
      },
    });
    
    console.log("테스트 사용자 생성됨:", user.email);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main().finally(() => prisma.$disconnect());
