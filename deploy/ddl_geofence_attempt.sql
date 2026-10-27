-- 2026-10-27 출퇴근 위치 판정 시도 기록(GeofenceAttempt) + AttendanceRequest.accuracy — 이예지 「지점 밖 판정」 조사 요청
-- 운영 적용: docker exec -i qubetee-db-1 psql -U postgres -d qubetee -f - < deploy/ddl_geofence_attempt.sql
CREATE TABLE IF NOT EXISTS "GeofenceAttempt" (
  id          TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  action      TEXT NOT NULL,
  latitude    DOUBLE PRECISION,
  longitude   DOUBLE PRECISION,
  accuracy    DOUBLE PRECISION,
  branch      TEXT,
  distance    INTEGER,
  radius      INTEGER,
  result      TEXT NOT NULL,
  "deviceId"  TEXT,
  platform    TEXT,
  "appVersion" TEXT
);
CREATE INDEX IF NOT EXISTS "GeofenceAttempt_userId_at_idx" ON "GeofenceAttempt"("userId", at);
CREATE INDEX IF NOT EXISTS "GeofenceAttempt_result_at_idx" ON "GeofenceAttempt"(result, at);
CREATE INDEX IF NOT EXISTS "GeofenceAttempt_at_idx" ON "GeofenceAttempt"(at);
ALTER TABLE "AttendanceRequest" ADD COLUMN IF NOT EXISTS accuracy DOUBLE PRECISION;
