-- 제출 요청 받는 사람 직접 지정 + 묶음 (2026-09-14). prisma/schema.prisma 의 SubmissionRequest.targetUserIds, SubmissionTargetGroup 과 1:1.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "SubmissionRequest" ADD COLUMN IF NOT EXISTS "targetUserIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "SubmissionTargetGroup" (
  "id"            TEXT PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "userIds"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdBy"     TEXT NOT NULL,
  "createdByName" TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionTargetGroup_name_key" ON "SubmissionTargetGroup"("name");

COMMIT;

-- 확인
SELECT count(*) AS req_col FROM information_schema.columns WHERE table_name='SubmissionRequest' AND column_name='targetUserIds';
SELECT count(*) AS grp_tbl FROM information_schema.tables WHERE table_name='SubmissionTargetGroup';
