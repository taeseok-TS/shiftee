-- 시프티 요청·승인 이력 보관(2026-10-26 디렉터 승인 「요청이력은 표+화면으로」). prisma/schema.prisma 의 ShifteeRequest 와 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다 — 코드 배포 **전에** 넣는다(관리자 「시프티 기록」 화면·API 가 이 표를 읽는다).
-- 적용: docker exec -i qubetee-db-1 sh -c 'psql -v ON_ERROR_STOP=1 -U $POSTGRES_USER -d $POSTGRES_DB' < deploy/ddl_shiftee_request.sql
-- 반입(CSV → 표, 사진 → uploads/private/shiftee-requests/)은 별도 스크립트. 되돌리기: DELETE FROM "ShifteeRequest" WHERE "importBatch" = '<묶음>';
BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "ShifteeRequest" (
  "id"           TEXT NOT NULL,                        -- 시프티 요청번호
  "userId"       TEXT,                                 -- 큐브티 User.id (매칭 안 되면 NULL, FK 없음)
  "empNo"        TEXT,                                 -- 큐브티 사번(원문)
  "name"         TEXT NOT NULL,                        -- 신청자 이름
  "branch"       TEXT,                                 -- 시프티 지점명
  "kind"         TEXT NOT NULL,                        -- 요청종류(시프티 원문 코드)
  "status"       TEXT NOT NULL,                        -- approved | rejected | cancelled | pending
  "step"         INTEGER,                              -- 결재 단계
  "cancelled"    BOOLEAN NOT NULL DEFAULT false,
  "requestedAt"  TIMESTAMP(3) NOT NULL,                -- 신청 시각(UTC — CSV 의 KST 에서 9시간 뺀 값)
  "content"      JSONB NOT NULL,                       -- 요청내용 원문 JSON
  "approver"     TEXT,
  "comment"      TEXT,
  "attachments"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],   -- 첨부 파일명 배열
  "importBatch"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ShifteeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShifteeRequest_userId_idx"      ON "ShifteeRequest"("userId");
CREATE INDEX IF NOT EXISTS "ShifteeRequest_requestedAt_idx" ON "ShifteeRequest"("requestedAt");
CREATE INDEX IF NOT EXISTS "ShifteeRequest_kind_idx"        ON "ShifteeRequest"("kind");
CREATE INDEX IF NOT EXISTS "ShifteeRequest_name_idx"        ON "ShifteeRequest"("name");

COMMIT;

-- 확인: \d "ShifteeRequest"
-- 반입 뒤 건수 확인: SELECT count(*), min("requestedAt"), max("requestedAt") FROM "ShifteeRequest";
