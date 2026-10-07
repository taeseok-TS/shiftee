-- 전자계약 발송 부가 정보(2026-10-07 QA76 묶음 7-가 #48 #65). prisma/schema.prisma 의 Contract 와 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 배포 전에 넣는다. 다시 돌려도 안전하다(IF NOT EXISTS).
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "templateVersion" INTEGER;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "sendMessage" TEXT;
COMMIT;
