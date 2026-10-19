-- 연도를 걸친 휴가 날짜별 귀속(2026-10-19 본부 이예지 답, 디렉터 「그렇게 진행해」). apps/web/prisma/schema.prisma 의 LeaveRequest.deductedByYear 와 1:1.
-- 승인 때 실제로 차감한 해마다 몫({"2026":1,"2027":1})을 휴가에 남긴다 — 복구·연차 대장·정산·리포트가 이 값을 먼저 쓴다.
-- 비어 있는(옛) 휴가는 코드가 옛 규칙(시작 해에 days)으로 읽으므로 기존 데이터를 채울 필요가 없다(채우지 않는다).
-- 운영에는 prisma db push 를 쓰지 않는다. **순서**: 이 DDL → 새 이미지 배포(열이 늘기만 하므로 옛 이미지도 그대로 돈다). 다시 돌려도 안전하다.
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE "LeaveRequest" ADD COLUMN IF NOT EXISTS "deductedByYear" JSONB;
COMMIT;
