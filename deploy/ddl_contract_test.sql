-- 나에게 테스트 발송(2026-10-08 QA76 #67) — 관리자 본인이 서명자인 시험 문서 표시.
-- 코드(lib/contract-test.ts·계약 목록·결재함)가 이 열을 읽으므로 **코드 배포 전에** 적용한다.
-- 적용: docker exec -i qubetee-db-1 sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB' < deploy/ddl_contract_test.sql
ALTER TABLE "Contract" ADD COLUMN IF NOT EXISTS "isTest" BOOLEAN NOT NULL DEFAULT false;
