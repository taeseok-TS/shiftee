-- 큐브티워크 「합격 · 성적 사례」 게시판 (2026-11-13 디렉터 결정). 운영 DB 에 손으로 먼저 적용한다(prisma db push 금지).
-- 만든 법: prisma migrate diff (schema 직전 → 직후). 새 표 3개만 — 기존 표는 건드리지 않는다.
BEGIN;
-- CreateTable
CREATE TABLE "SuccessCase" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "studentGrade" TEXT NOT NULL,
    "studentSurname" TEXT NOT NULL,
    "studentGender" TEXT,
    "region" TEXT,
    "schoolType" TEXT,
    "periodMonths" INTEGER,
    "gradeBasis" TEXT,
    "gradeFrom" DOUBLE PRECISION,
    "gradeTo" DOUBLE PRECISION,
    "beforeText" TEXT,
    "afterText" TEXT,
    "results" JSONB NOT NULL DEFAULT '[]',
    "schoolsText" TEXT NOT NULL DEFAULT '',
    "strategy" TEXT NOT NULL,
    "files" JSONB NOT NULL DEFAULT '[]',
    "maskConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorBranch" TEXT,
    "authorJobGroup" TEXT,
    "marketingSubmissionId" TEXT,
    "cheerCount" INTEGER NOT NULL DEFAULT 0,
    "commentCount" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuccessCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuccessCaseComment" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT NOT NULL,
    "userBranch" TEXT,
    "content" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuccessCaseComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuccessCaseCheer" (
    "caseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuccessCaseCheer_pkey" PRIMARY KEY ("caseId","userId")
);

-- CreateIndex
CREATE INDEX "SuccessCase_createdAt_idx" ON "SuccessCase"("createdAt");

-- CreateIndex
CREATE INDEX "SuccessCase_kind_idx" ON "SuccessCase"("kind");

-- CreateIndex
CREATE INDEX "SuccessCase_authorBranch_idx" ON "SuccessCase"("authorBranch");

-- CreateIndex
CREATE INDEX "SuccessCaseComment_caseId_createdAt_idx" ON "SuccessCaseComment"("caseId", "createdAt");

-- AddForeignKey
ALTER TABLE "SuccessCaseComment" ADD CONSTRAINT "SuccessCaseComment_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SuccessCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuccessCaseCheer" ADD CONSTRAINT "SuccessCaseCheer_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "SuccessCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
COMMIT;
