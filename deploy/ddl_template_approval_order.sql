-- 계약서 템플릿 결재 순서(2026-10-12 개선 제안 #213-2). prisma/schema.prisma 의 ContractTemplate.approvalSteps / approvalLocked 와 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 코드 배포 전에 넣는다. 다시 돌려도 안전하다(IF NOT EXISTS).
-- approvalSteps NULL = 순서 없음(발송 창은 종전과 같은 본부 → 원장 → 근로자). approvalLocked true = 발송 때 순서 변경 불가(기본).
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "approvalSteps" JSONB;
ALTER TABLE "ContractTemplate" ADD COLUMN IF NOT EXISTS "approvalLocked" BOOLEAN NOT NULL DEFAULT true;
COMMIT;
