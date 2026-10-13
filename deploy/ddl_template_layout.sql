-- PDF 양식 칸 배치(2026-10-13 QA76 #22 2단계 「끌어다 놓는 편집기」) — 칸 좌표·종류·담당·채우는 방식(JSON). 새 컬럼만 추가(기존 행은 NULL = 배치 없음).
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "layout" JSONB;
