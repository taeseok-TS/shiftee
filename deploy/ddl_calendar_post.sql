-- 「이달의 지점 공유」를 한 칸 메모 → 글이 쌓이는 방식으로(2026-10-20 디렉터 「어 진행하자」). schema.prisma 의 WorkCalendarPost 와 1:1.
-- 앞서 만든 WorkCalendarNote 표는 운영에 0건(10/20 확인) — 지우지 않고 그대로 둔다(코드는 더 쓰지 않음).
-- 운영에는 prisma db push 를 쓰지 않는다. **순서**: 이 DDL → 새 이미지 배포. 다시 돌려도 안전하다.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS "WorkCalendarPost" (
  "id" TEXT NOT NULL,
  "branch" TEXT NOT NULL,
  "ym" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT false,
  "authorId" TEXT NOT NULL,
  "authorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkCalendarPost_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "WorkCalendarPost_branch_ym_idx" ON "WorkCalendarPost"("branch", "ym");
-- 내용을 고친 때(「(수정됨)」 표시) — 검증 지적: updatedAt 은 고정·지점명 변경에도 바뀐다
ALTER TABLE "WorkCalendarPost" ADD COLUMN IF NOT EXISTS "editedAt" TIMESTAMP(3);
COMMIT;
