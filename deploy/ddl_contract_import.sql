-- 모두싸인 체결본 이관(2026-10-08 QA76 #4). prisma/schema.prisma 의 Contract.importBatch·importRef·certificateUrl 과 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 코드 배포 **전에** 넣는다(계약 목록 조회가 이 열을 읽는다).
-- 적용: docker exec -i qubetee-db-1 sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB' < deploy/ddl_contract_import.sql
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "importBatch" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "importRef" TEXT;
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "certificateUrl" TEXT;
CREATE INDEX IF NOT EXISTS "Contract_importBatch_idx" ON "Contract"("importBatch");
CREATE INDEX IF NOT EXISTS "Contract_importRef_idx" ON "Contract"("importRef");
