-- 캘린더 개선 제안 #221(일정 시각)·#222(오른쪽 「이달의 지점 공유」 메모), 2026-10-20 디렉터 「처리하자」.
-- apps/web/prisma/schema.prisma 의 WorkCalendarEvent.startTime/endTime, WorkCalendarNote 와 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다. **순서**: 이 DDL → 새 이미지 배포(열·표가 늘기만 하므로 옛 이미지도 그대로 돈다). 다시 돌려도 안전하다.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "WorkCalendarEvent" ADD COLUMN IF NOT EXISTS "startTime" TEXT;
ALTER TABLE "WorkCalendarEvent" ADD COLUMN IF NOT EXISTS "endTime" TEXT;
CREATE TABLE IF NOT EXISTS "WorkCalendarNote" (
  "id" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "ym" TEXT NOT NULL,
  "content" TEXT NOT NULL DEFAULT '',
  "updatedBy" TEXT,
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkCalendarNote_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WorkCalendarNote_branch_ym_key" ON "WorkCalendarNote"("branch", "ym");
COMMIT;
