-- #243 (2026-11-05 권경욱 제안, 디렉터 「추천대로」) 캘린더 일정 순서 — 같은 날 안에서 끌어 정한 순서. 비어 있으면 끌어 정한 일정 뒤에 종일 먼저 · 이른 시각 순
ALTER TABLE "WorkCalendarEvent" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER;
