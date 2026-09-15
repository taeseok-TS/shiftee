-- 포털(직영인사) 인원명부 → 큐브티 한 방향 동기화 (2026-09-15). prisma/schema.prisma 의 PortalSyncRun·PortalSyncChange 와 1:1.
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "PortalSyncRun" (
  "id"         TEXT PRIMARY KEY,
  "trigger"    TEXT NOT NULL,
  "startedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "ok"         BOOLEAN NOT NULL DEFAULT false,
  "error"      TEXT,
  "fetched"    INTEGER NOT NULL DEFAULT 0,
  "matched"    INTEGER NOT NULL DEFAULT 0,
  "applied"    INTEGER NOT NULL DEFAULT 0,
  "pending"    INTEGER NOT NULL DEFAULT 0,
  "skipped"    INTEGER NOT NULL DEFAULT 0,
  "actorName"  TEXT,
  "summary"    JSONB
);
CREATE INDEX IF NOT EXISTS "PortalSyncRun_startedAt_idx" ON "PortalSyncRun"("startedAt");

CREATE TABLE IF NOT EXISTS "PortalSyncChange" (
  "id"        TEXT PRIMARY KEY,
  "runId"     TEXT NOT NULL,
  "empNo"     INTEGER NOT NULL,
  "portalId"  TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "userId"    TEXT,
  "kind"      TEXT NOT NULL,
  "diff"      JSONB NOT NULL,
  "sig"       TEXT NOT NULL,
  "status"    TEXT NOT NULL,
  "decidedBy" TEXT,
  "decidedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortalSyncChange_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PortalSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "PortalSyncChange_status_kind_idx" ON "PortalSyncChange"("status", "kind");
CREATE INDEX IF NOT EXISTS "PortalSyncChange_empNo_idx" ON "PortalSyncChange"("empNo");
CREATE INDEX IF NOT EXISTS "PortalSyncChange_sig_idx" ON "PortalSyncChange"("sig");

COMMIT;

-- 확인
SELECT count(*) AS tables FROM information_schema.tables WHERE table_name IN ('PortalSyncRun', 'PortalSyncChange');
