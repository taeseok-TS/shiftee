-- 2026-10-15 재계약 결재 순서(양식별) — 작성 창 「계약 구분」이 재계약이면 이 순서로 발송(이예지 요청, 디렉터 A안)
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "approvalStepsRenewal" JSONB;
