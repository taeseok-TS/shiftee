-- 합격 · 성적 사례 「목록 맨 위 고정」 (2026-11-26 디렉터). 운영 DB 에 손으로 먼저 적용한다(prisma db push 금지).
-- 빈 칸(NULL) 하나만 더한다 — 옛 코드는 이 칸을 모르고 그대로 돈다.
ALTER TABLE "SuccessCase" ADD COLUMN IF NOT EXISTS "pinnedAt" TIMESTAMP(3);
