-- 마케팅 자료 + 회사 연동 키 (2026-09-14). prisma/schema.prisma 의 Submission.consent/publishedAt/publishedUrl/publishedBy, ApiKey.kind 와 1:1.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "consent"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "publishedAt"  TIMESTAMP(3);
ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "publishedUrl" TEXT;
ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "publishedBy"  TEXT;
ALTER TABLE "ApiKey"     ADD COLUMN IF NOT EXISTS "kind"         TEXT NOT NULL DEFAULT 'PERSONAL';

-- 마케팅 자료 분류 시드 — 이미 있으면 건드리지 않는다
INSERT INTO "SubmissionCategory" ("id", "group", "name", "sortOrder") VALUES
  ('cat_mkt_class',  'MARKETING', '수업·행사 사례',   200),
  ('cat_mkt_score',  'MARKETING', '성적 향상 사례',   210),
  ('cat_mkt_photo',  'MARKETING', '지점 사진',        220),
  ('cat_mkt_review', 'MARKETING', '학부모·학생 후기', 230),
  ('cat_mkt_etc',    'MARKETING', '기타 마케팅 자료', 290)
ON CONFLICT ("group", "name") DO NOTHING;

COMMIT;

-- 확인
SELECT count(*) AS sub_cols FROM information_schema.columns WHERE table_name='Submission' AND column_name IN ('consent','publishedAt','publishedUrl','publishedBy');
SELECT count(*) AS key_kind FROM information_schema.columns WHERE table_name='ApiKey' AND column_name='kind';
SELECT count(*) AS mkt_cats FROM "SubmissionCategory" WHERE "group"='MARKETING';
