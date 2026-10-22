-- 연봉 화면(2026-10-22 디렉터): 「연봉 보기」 권한 + 연봉 이력 표. prisma/schema.prisma User.canViewSalary · SalaryRecord 와 같게.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "canViewSalary" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "SalaryRecord" (
  "id" TEXT NOT NULL,
  "empNo" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "jobTitle" TEXT,
  "startDate" DATE NOT NULL,
  "endDate" DATE,
  "amount" INTEGER NOT NULL,
  "renewed" BOOLEAN NOT NULL DEFAULT false,
  "importBatch" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SalaryRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SalaryRecord_empNo_startDate_key" ON "SalaryRecord"("empNo", "startDate");
CREATE INDEX IF NOT EXISTS "SalaryRecord_empNo_idx" ON "SalaryRecord"("empNo");
