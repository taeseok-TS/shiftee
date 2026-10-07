-- 원장대행 지정 표 (2026-10-07 본부 답변 #3). prisma/schema.prisma 의 ApprovalDelegate 와 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 이 파일을 배포 전에 넣는다.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "ApprovalDelegate" (
  "id"         TEXT PRIMARY KEY,
  "branch"     TEXT NOT NULL,
  "delegateId" TEXT NOT NULL,
  "startDate"  DATE NOT NULL,
  "endDate"    DATE NOT NULL,
  "note"       TEXT,
  "createdBy"  TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"  TIMESTAMP(3),
  "revokedBy"  TEXT
);
CREATE INDEX IF NOT EXISTS "ApprovalDelegate_delegateId_idx" ON "ApprovalDelegate"("delegateId");
CREATE INDEX IF NOT EXISTS "ApprovalDelegate_branch_idx" ON "ApprovalDelegate"("branch");

COMMIT;

-- 확인: \d "ApprovalDelegate"
