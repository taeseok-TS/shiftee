-- 2026-10-16 이예지 QA 7 외부 계약자 이메일(코드 배포 전에 적용)
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "externalEmail" TEXT;
