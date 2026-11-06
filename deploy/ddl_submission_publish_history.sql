-- 2026-11-06 디렉터 승인 — 마케팅 자료 블로그 발행 기록(여러 번 발행 · 여러 자료 합쳐 발행). [{ url, note, at, by }] 오래된 것부터. 비어 있으면 publishedUrl 하나로 본다
ALTER TABLE "Submission" ADD COLUMN IF NOT EXISTS "publishHistory" JSONB;
