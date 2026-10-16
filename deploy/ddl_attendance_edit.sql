-- 출퇴근 기록 수정 이력(2026-10-16 이예지 QA #219-15). prisma/schema.prisma 의 AttendanceEdit 와 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 배포 전에 넣는다(새 코드가 이 표에 쓰므로 표가 먼저 있어야 수정·승인이 막히지 않는다).
-- 덧붙이기 전용 표 — 칸마다 처음 바뀐 줄의 before 가 「원래 찍힌 시각」이다. 지우거나 고치지 않는다.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "AttendanceEdit" (
  "id"           TEXT NOT NULL,
  "attendanceId" TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "workDate"     DATE NOT NULL,
  "kind"         TEXT NOT NULL,
  "beforeIn"     TIMESTAMP(3),
  "beforeOut"    TIMESTAMP(3),
  "afterIn"      TIMESTAMP(3),
  "afterOut"     TIMESTAMP(3),
  "beforeStatus" TEXT,
  "afterStatus"  TEXT,
  "reason"       TEXT,
  "requestId"    TEXT,
  "editorId"     TEXT,
  "editorName"   TEXT NOT NULL,
  "approverName" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceEdit_pkey" PRIMARY KEY ("id")
);
DO $$ BEGIN
  ALTER TABLE "AttendanceEdit" ADD CONSTRAINT "AttendanceEdit_attendanceId_fkey"
    FOREIGN KEY ("attendanceId") REFERENCES "Attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AttendanceEdit" ADD CONSTRAINT "AttendanceEdit_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "AttendanceEdit_attendanceId_createdAt_idx" ON "AttendanceEdit"("attendanceId", "createdAt");
CREATE INDEX IF NOT EXISTS "AttendanceEdit_userId_workDate_idx" ON "AttendanceEdit"("userId", "workDate");

COMMIT;

-- 확인: \d "AttendanceEdit"
