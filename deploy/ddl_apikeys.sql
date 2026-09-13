-- 개인 API 키 2단계 — 운영 수동 DDL (2026-09-13). prisma/schema.prisma 의 ApiKey·User.apiKeysAllowed·WorkMessage.apiKeyId 와 1:1.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "ApiKey" (
  "id"            TEXT PRIMARY KEY,
  "userId"        TEXT NOT NULL,
  "name"          TEXT NOT NULL,
  "prefix"        TEXT NOT NULL,
  "keyHash"       TEXT NOT NULL,
  "scopes"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "channelIds"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "lastUsedAt"    TIMESTAMP(3),
  "lastUsedIp"    TEXT,
  "suspendedAt"   TIMESTAMP(3),
  "suspendReason" TEXT,
  "revokedAt"     TIMESTAMP(3),
  "revokedBy"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ApiKey_keyHash_key" ON "ApiKey"("keyHash");
CREATE INDEX IF NOT EXISTS "ApiKey_userId_idx" ON "ApiKey"("userId");

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "apiKeysAllowed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WorkMessage" ADD COLUMN IF NOT EXISTS "apiKeyId" TEXT;

COMMIT;

-- 확인
SELECT count(*) AS apikey_cols FROM information_schema.columns WHERE table_name='ApiKey';
SELECT count(*) AS user_col FROM information_schema.columns WHERE table_name='User' AND column_name='apiKeysAllowed';
SELECT count(*) AS msg_col FROM information_schema.columns WHERE table_name='WorkMessage' AND column_name='apiKeyId';
