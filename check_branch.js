const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const testDaecheon = await prisma.user.findUnique({
      where: { email: 'testdaecheon@shiftee.com' },
      select: { name: true, email: true, branch: true }
    });

    const testGangwon = await prisma.user.findUnique({
      where: { email: 'testgangwon@shiftee.com' },
      select: { name: true, email: true, branch: true }
    });

    console.log('test daecheon:', JSON.stringify(testDaecheon, null, 2));
    console.log('test gangwon:', JSON.stringify(testGangwon, null, 2));
  } finally {
    await prisma.$disconnect();
  }
})();
