-- 보상휴가·대체휴일 부여 기록(2026-10-08 QA76 #50 #56). prisma/schema.prisma 의 Holiday.grantsLeave·LeaveGrant 와 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 코드 배포 **전에** 넣는다(공휴일 조회가 grantsLeave 열을 읽는다).
-- 적용: docker exec -i qubetee-db-1 sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB' < deploy/ddl_leave_grant.sql
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE "Holiday" ADD COLUMN IF NOT EXISTS "grantsLeave" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "LeaveGrant" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL REFERENCES "User"("id"),
  "group"     TEXT NOT NULL,
  "days"      DOUBLE PRECISION NOT NULL,
  "workDate"  DATE,
  "source"    TEXT NOT NULL,
  "note"      TEXT NOT NULL,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeaveGrant_userId_group_workDate_key" ON "LeaveGrant"("userId", "group", "workDate");
CREATE INDEX IF NOT EXISTS "LeaveGrant_userId_group_idx" ON "LeaveGrant"("userId", "group");

COMMIT;
