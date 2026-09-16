-- 예약 전송 첨부 (개선 제안 #208, 2026-09-16). prisma/schema.prisma 의 WorkScheduledMessage 와 1:1.
-- ※ 운영(cubetee.co.kr)에는 2026-09-16 에 이미 적용돼 있다(컬럼 존재 확인함). 이 파일은 기록과
--   고객사 인스턴스용이다 — 기능 커밋에 DDL 을 동봉하지 않아 뒤늦게 남긴다(검증관 지적).
BEGIN;
SET LOCAL lock_timeout = '5s';

-- 예약할 때 미리 올려둔 첨부의 주소만 보관한다. [{ fileUrl, fileName, fileType, owned }]
--   owned 는 **서버만** 찍는다(이 예약이 데려온 새 파일인지). 취소 시 그 파일만 지운다.
ALTER TABLE "WorkScheduledMessage" ADD COLUMN IF NOT EXISTS "attachments" JSONB;

-- 첨부를 글보다 먼저 붙였는지 — 발송 때 렌더 순서를 그대로 재현한다
ALTER TABLE "WorkScheduledMessage" ADD COLUMN IF NOT EXISTS "attachFirst" BOOLEAN NOT NULL DEFAULT false;

COMMIT;

-- 확인:
--   \d "WorkScheduledMessage"
--   → attachments (jsonb, null 허용) · attachFirst (boolean, default false)
