-- 휴가 유형 직접 추가(2026-10-12 개선 제안 #216-1). prisma/schema.prisma 의 LeaveTypeDef · LeaveRequest.type(String) 과 1:1.
-- 운영에는 prisma db push 를 쓰지 않는다. **순서**: 새 이미지 빌드 완료 → 이 DDL → docker compose up (옛 이미지는 enum 열, 새 이미지는 text 열을 기대하므로 틈을 최소로).
-- 다시 돌려도 안전하다.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- 1) LeaveRequest.type: enum LeaveType → text (값은 그대로). enum 타입 자체는 남겨 둔다(다른 참조 없음, 해가 없다)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'LeaveRequest' AND column_name = 'type' AND data_type = 'USER-DEFINED') THEN
    ALTER TABLE "LeaveRequest" ALTER COLUMN "type" TYPE TEXT USING "type"::text;
  END IF;
END $$;
-- 2) 본부가 만드는 휴가 유형
CREATE TABLE IF NOT EXISTS "LeaveTypeDef" (
  "id"             TEXT NOT NULL,
  "code"           TEXT NOT NULL,
  "label"          TEXT NOT NULL,
  "group"          TEXT NOT NULL,
  "unit"           TEXT NOT NULL DEFAULT 'FULL',
  "paidHours"      INTEGER NOT NULL DEFAULT 8,
  "deducts"        BOOLEAN NOT NULL DEFAULT false,
  "attachRequired" TEXT,
  "notice"         TEXT,
  "selectable"     BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "createdBy"      TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LeaveTypeDef_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "LeaveTypeDef_code_key" ON "LeaveTypeDef"("code");
COMMIT;
