-- 근무일정 엑셀 업로드(2026-10-13 QA76 #75) — 가져온 묶음 표식(되돌리기용). 새 컬럼만 추가(기존 행은 NULL), 되돌릴 일 없음.
ALTER TABLE "Schedule" ADD COLUMN IF NOT EXISTS "importBatch" TEXT;
CREATE INDEX IF NOT EXISTS "Schedule_importBatch_idx" ON "Schedule" ("importBatch");
