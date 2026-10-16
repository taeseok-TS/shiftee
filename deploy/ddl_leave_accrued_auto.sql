-- 2026-10-16 #31 연차 회계연도 기준 — 자동 발생 몫(코드 배포 전에 적용)
ALTER TABLE "LeaveBalance" ADD COLUMN IF NOT EXISTS "accruedAuto" DOUBLE PRECISION;
