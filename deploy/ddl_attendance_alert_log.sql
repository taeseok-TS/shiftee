-- 휴대폰 근태 알림 발송 기록(2026-10-07 QA #11). prisma/schema.prisma 의 AttendanceAlertLog 와 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 배포 전에 넣는다.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS "AttendanceAlertLog" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "date"      DATE NOT NULL,
  "kind"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceAlertLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AttendanceAlertLog_userId_date_kind_key" ON "AttendanceAlertLog"("userId", "date", "kind");
CREATE INDEX IF NOT EXISTS "AttendanceAlertLog_date_idx" ON "AttendanceAlertLog"("date");
COMMIT;
