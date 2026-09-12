-- 큐브티워크 자료제출 1단계 — 운영 수동 DDL (2026-09-13). prisma/schema.prisma 의 세 모델과 1:1.
-- 적용: pg_dump -s 백업 → psql -v ON_ERROR_STOP=1 -f 이 파일 → 컬럼 확인 (deploy_tsa.sh 패턴)
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "SubmissionCategory" (
  "id"        TEXT PRIMARY KEY,
  "group"     TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active"    BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "SubmissionCategory_group_name_key" ON "SubmissionCategory"("group", "name");

CREATE TABLE IF NOT EXISTS "SubmissionRequest" (
  "id"                TEXT PRIMARY KEY,
  "title"             TEXT NOT NULL,
  "description"       TEXT,
  "categoryId"        TEXT NOT NULL REFERENCES "SubmissionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "targetJobGroups"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "targetBranches"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "dueDate"           DATE,
  "createdBy"         TEXT NOT NULL,
  "createdByName"     TEXT NOT NULL,
  "closedAt"          TIMESTAMP(3),
  "remindedAt"        TIMESTAMP(3),
  "overdueNotifiedAt" TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "SubmissionRequest_dueDate_idx"   ON "SubmissionRequest"("dueDate");
CREATE INDEX IF NOT EXISTS "SubmissionRequest_createdAt_idx" ON "SubmissionRequest"("createdAt");

CREATE TABLE IF NOT EXISTS "Submission" (
  "id"             TEXT PRIMARY KEY,
  "requestId"      TEXT REFERENCES "SubmissionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "categoryId"     TEXT NOT NULL REFERENCES "SubmissionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "userId"         TEXT NOT NULL,
  "userName"       TEXT NOT NULL,
  "userBranch"     TEXT,
  "userJobGroup"   TEXT,
  "userPosition"   TEXT,
  "yearMonth"      TEXT NOT NULL,
  "title"          TEXT NOT NULL,
  "memo"           TEXT,
  "files"          JSONB NOT NULL,
  "status"         TEXT NOT NULL DEFAULT 'SUBMITTED',
  "checkedBy"      TEXT,
  "checkedAt"      TIMESTAMP(3),
  "shared"         BOOLEAN NOT NULL DEFAULT false,
  "shareJobGroups" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sharedBy"       TEXT,
  "sharedAt"       TIMESTAMP(3),
  "deletedAt"      TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "Submission_userId_idx"     ON "Submission"("userId");
CREATE INDEX IF NOT EXISTS "Submission_requestId_idx"  ON "Submission"("requestId");
CREATE INDEX IF NOT EXISTS "Submission_categoryId_idx" ON "Submission"("categoryId");
CREATE INDEX IF NOT EXISTS "Submission_createdAt_idx"  ON "Submission"("createdAt");
CREATE INDEX IF NOT EXISTS "Submission_shared_idx"     ON "Submission"("shared");

-- 분류 시드 — 디렉터 확정 목록. 이미 있으면 건드리지 않는다(본부가 화면에서 바꾼 값 보존).
INSERT INTO "SubmissionCategory" ("id", "group", "name", "sortOrder") VALUES
  ('cat_edu_under1y', 'EDU',   '1년미만교육',   10),
  ('cat_edu_how',     'EDU',   'HOW교육',       20),
  ('cat_edu_plc',     'EDU',   'PLC교육',       30),
  ('cat_edu_route',   'EDU',   '루트교육',      40),
  ('cat_edu_head',    'EDU',   '교실장실무교육', 50),
  ('cat_edu_manager', 'EDU',   '매니저실무교육', 60),
  ('cat_edu_etc',     'EDU',   '기타 교육',     90),
  ('cat_promo',       'PROMO', '본부 프로모션', 100),
  ('cat_event',       'EVENT', '본부 이벤트',   110)
ON CONFLICT ("group", "name") DO NOTHING;

COMMIT;

-- 확인
SELECT table_name, count(*) AS cols FROM information_schema.columns
 WHERE table_name IN ('SubmissionCategory','SubmissionRequest','Submission') GROUP BY table_name ORDER BY 1;
SELECT "group", count(*) FROM "SubmissionCategory" GROUP BY 1 ORDER BY 1;
