-- 큐브티워크 이모티콘(스티커) 표 (2026-09-29). prisma/schema.prisma 의 EmoticonSet·Emoticon 과 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 이 파일을 배포 전에 넣는다.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "EmoticonSet" (
  "id"        TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "EmoticonSet_sortOrder_idx" ON "EmoticonSet"("sortOrder");

CREATE TABLE IF NOT EXISTS "Emoticon" (
  "id"        TEXT PRIMARY KEY,
  "setId"     TEXT NOT NULL REFERENCES "EmoticonSet"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name"      TEXT NOT NULL,
  "url"       TEXT NOT NULL,
  "animated"  BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Emoticon_url_key" ON "Emoticon"("url");
CREATE INDEX IF NOT EXISTS "Emoticon_setId_sortOrder_idx" ON "Emoticon"("setId", "sortOrder");

COMMIT;

-- 확인: \d "EmoticonSet"  \d "Emoticon"
