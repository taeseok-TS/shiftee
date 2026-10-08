-- 시프티 휴가 사용 내역 가져오기(2026-10-08 QA76 #2). prisma/schema.prisma 의 LeaveRequest.importBatch 와 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 코드 배포 **전에** 넣는다(휴가 목록 조회가 이 열을 읽는다).
-- 적용: docker exec -i qubetee-db-1 sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB' < deploy/ddl_leave_import.sql
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "importBatch" TEXT;
CREATE INDEX IF NOT EXISTS "LeaveRequest_importBatch_idx" ON "LeaveRequest"("importBatch");
