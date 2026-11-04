-- #240 (2026-11-04 권경욱 제안) 「이달의 지점 공유」 글 순서 바꾸기 — 원장·관리자가 정한 순서. 비어 있으면 새 글(그 묶음 맨 위)
ALTER TABLE "WorkCalendarPost" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER;
