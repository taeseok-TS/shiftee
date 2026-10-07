-- 근무일정 수정·삭제 요청(2026-10-07 QA #49). prisma/schema.prisma 의 ScheduleRequest.kind 와 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 배포 전에 넣는다. 기존 신청은 모두 CREATE(새 일정 신청)다.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "ScheduleRequest" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'CREATE';
COMMIT;
