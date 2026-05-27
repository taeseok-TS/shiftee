const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  try {
    const hashedPassword = await bcrypt.hash("password123", 10);
    
    const users = [
      {
        email: "manager@example.com",
        password: hashedPassword,
        name: "지점 관리자",
        role: "MANAGER",
        department: "영업팀",
        position: "팀장",
        branch: "서울강남점",
        isActive: true,
      },
      {
        email: "employee@example.com",
        password: hashedPassword,
        name: "일반 직원",
        role: "EMPLOYEE",
        department: "개발팀",
        position: "사원",
        branch: "서울강남점",
        isActive: true,
      },
      {
        email: "approver@example.com",
        password: hashedPassword,
        name: "승인자",
        role: "EMPLOYEE",
        department: "인사팀",
        position: "과장",
        branch: "서울강남점",
        isActive: true,
      },
    ];
    
    for (const userData of users) {
      try {
        await prisma.user.create({ data: userData });
        console.log("생성됨:", userData.email);
      } catch (e) {
        await prisma.user.update({
          where: { email: userData.email },
          data: { password: hashedPassword }
        });
        console.log("업데이트됨:", userData.email);
      }
    }
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main().finally(() => prisma.$disconnect());
