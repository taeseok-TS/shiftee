const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  try {
    const hashedPassword = await bcrypt.hash("password123", 10);
    
    const user = await prisma.user.update({
      where: { email: "admin@example.com" },
      data: {
        password: hashedPassword,
      },
    });
    
    console.log("사용자 업데이트됨:", user.email);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

main().finally(() => prisma.$disconnect());
