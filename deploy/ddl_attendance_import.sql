-- 시프티 출퇴근 기록 이관 묶음(2026-10-22 본부 요청 6 — 근로감독 대비 보관). 운영 10/22 적용.
-- 옮긴 기록은 미마감·누락 안내·일괄 마감·본인 동의·수정 요청·보상/대체 자동 부여에서 빠진다(importBatch IS NULL 조건).
-- 되돌리기: AttendanceEdit 가 붙은 행은 먼저 그 이력을 지운 뒤 DELETE FROM "Attendance" WHERE "importBatch" = '<묶음>';
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "importBatch" TEXT;
CREATE INDEX IF NOT EXISTS "Attendance_importBatch_idx" ON "Attendance"("importBatch");
