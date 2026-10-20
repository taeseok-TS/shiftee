-- 외부 DM 발송 기록(2026-10-20 이예지 요청 「직영 포털 → 큐브티 1:1 DM」). schema.prisma 의 ExternalDm 과 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다. **순서**: 이 DDL → 새 이미지 배포. 다시 돌려도 안전하다.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS "ExternalDm" (
  "id" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "refId" TEXT,
  "empNo" INTEGER NOT NULL,
  "userId" TEXT,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalDm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ExternalDm_keyId_refId_empNo_key" ON "ExternalDm"("keyId", "refId", "empNo");
CREATE INDEX IF NOT EXISTS "ExternalDm_createdAt_idx" ON "ExternalDm"("createdAt");
COMMIT;
