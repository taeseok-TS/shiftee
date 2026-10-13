-- 계약 양식 칸 설정(2026-10-13 QA76 #22 1단계) — 칸마다 채우는 방식·필수·자동 값(JSON). 새 컬럼만 추가(기존 행은 NULL = 종전 규칙).
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "fieldSettings" JSONB;
