-- 출퇴근 요청(2026-10-07 QA #9 #13 #15) + 출근·퇴근 장소 따로 기록(#36).
-- prisma/schema.prisma 의 AttendanceRequest·Attendance 와 1:1. 운영에는 prisma db push 를 쓰지 않는다 — 배포 전에 넣는다.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "clockInPlace" TEXT;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "clockOutPlace" TEXT;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "clockOutLat" DOUBLE PRECISION;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "clockOutLng" DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS "AttendanceRequest" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "kind"         TEXT NOT NULL,
  "action"       TEXT,
  "workDate"     DATE NOT NULL,
  "requestedAt"  TIMESTAMP(3) NOT NULL,
  "clockIn"      TIMESTAMP(3),
  "clockOut"     TIMESTAMP(3),
  "clockOutPlace" TEXT,
  "clockOutLat"  DOUBLE PRECISION,
  "clockOutLng"  DOUBLE PRECISION,
  "reason"       TEXT,
  "memo"         TEXT,
  "latitude"     DOUBLE PRECISION,
  "longitude"    DOUBLE PRECISION,
  "photoPath"    TEXT,
  "deviceId"     TEXT,
  "deviceName"   TEXT,
  "platform"     TEXT,
  "approverRole" TEXT NOT NULL,
  "branch"       TEXT,
  "status"       TEXT NOT NULL DEFAULT 'PENDING',
  "decidedBy"    TEXT,
  "decidedAt"    TIMESTAMP(3),
  "rejectReason" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AttendanceRequest_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "AttendanceRequest" ADD CONSTRAINT "AttendanceRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "AttendanceRequest_userId_status_idx" ON "AttendanceRequest"("userId", "status");
CREATE INDEX IF NOT EXISTS "AttendanceRequest_branch_status_idx" ON "AttendanceRequest"("branch", "status");
CREATE INDEX IF NOT EXISTS "AttendanceRequest_status_idx" ON "AttendanceRequest"("status");

COMMIT;

-- 확인: \d "AttendanceRequest"   \d "Attendance"
