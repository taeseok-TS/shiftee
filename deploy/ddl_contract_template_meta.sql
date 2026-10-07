-- 계약서 템플릿 라벨·고정·파일 이력(2026-10-07 QA76 #78). prisma/schema.prisma 의 ContractTemplate·ContractTemplateVersion 과 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 배포 전에 넣는다. 다시 돌려도 안전하다(IF NOT EXISTS).
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "labels" TEXT[] DEFAULT ARRAY[]::TEXT[];   -- Prisma String[] 과 같게(NOT NULL 없음)
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "pinned" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS "ContractTemplateVersion" (
  "id"         TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "version"    INTEGER NOT NULL,
  "fileUrl"    TEXT NOT NULL,
  "replacedBy" TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractTemplateVersion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ContractTemplateVersion_templateId_version_idx" ON "ContractTemplateVersion"("templateId", "version");
DO $$ BEGIN
  ALTER TABLE "ContractTemplateVersion" ADD CONSTRAINT "ContractTemplateVersion_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "ContractTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMIT;
