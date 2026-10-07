-- 전자계약 서명 기한(2026-10-07 QA76 #45, 본부 답변 #35). prisma/schema.prisma 의 Contract.signDeadline 과 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 배포 전에 넣는다. 다시 돌려도 안전하다(IF NOT EXISTS).
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "signDeadline" TIMESTAMP(3);
COMMIT;
