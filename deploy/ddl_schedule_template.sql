-- 근무일정 템플릿(2026-10-07 QA #10, 본부 답변 #16). prisma/schema.prisma 의 ScheduleTemplate 과 1:1.
-- 시프티 템플릿 엑셀(SHIFTEE-SHIFT-TEMPLATES-2026-10-07.xlsx) 34개를 그대로 옮긴다. 조직이 빈 것은 전사 공통(branches 빈 배열).
-- 지점명은 「○○ 직영점」 → 큐브티 지점명(서현·수내·야탑은 분당○○, 야탑은 2관 포함). 압구정은 큐브티에 지점이 없어 그대로 둔다(그 지점이 생기면 보인다). 「10 - 3:30 서현 코디님 _방학근무」는 10:00~15:30 으로 바로잡음.
-- 운영에는 prisma db push 를 쓰지 않는다 — 배포 전에 넣는다. 다시 넣어도 같은 id 는 건너뛴다.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS "ScheduleTemplate" (
  "id"        TEXT NOT NULL,
  "code"      TEXT,
  "name"      TEXT NOT NULL,
  "startTime" TEXT NOT NULL,
  "endTime"   TEXT NOT NULL,
  "branches"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "jobs"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "color"     TEXT,
  "memo"      TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ScheduleTemplate_pkey" PRIMARY KEY ("id")
);
INSERT INTO "ScheduleTemplate" ("id","code","name","startTime","endTime","branches","jobs","color","memo","sortOrder") VALUES
  ('stpl_01', '10-7', '10-7', '10:00', '19:00', ARRAY['평촌']::TEXT[], ARRAY[]::TEXT[], '#935116', NULL, 1),
  ('stpl_02', '10:30', '10:30', '10:30', '19:30', ARRAY['잠실']::TEXT[], ARRAY[]::TEXT[], '#2E86C1', NULL, 2),
  ('stpl_03', '4시-10시', '코디님근무(4-10시)', '16:00', '22:00', ARRAY['목동']::TEXT[], ARRAY['코디']::TEXT[], '#16a085', NULL, 3),
  ('stpl_04', '목동점_주말근무', '목동점_주말근무_매니저', '11:00', '18:00', ARRAY['목동']::TEXT[], ARRAY['매니저','원장','원장대행']::TEXT[], '#34495E', NULL, 4),
  ('stpl_05', '방학', '방학일정', '10:00', '19:00', ARRAY['문정','잠실']::TEXT[], ARRAY[]::TEXT[], '#3498DB', NULL, 5),
  ('stpl_06', '방학2', '방학일정2', '11:00', '20:00', ARRAY['문정']::TEXT[], ARRAY[]::TEXT[], '#9B59B6', NULL, 6),
  ('stpl_07', '상담실장', '대치_상담실장', '10:00', '18:00', ARRAY['대치']::TEXT[], ARRAY[]::TEXT[], '#73C6B6', NULL, 7),
  ('stpl_08', '썸머스쿨', '오전8시', '08:00', '17:00', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '#aed6f1', NULL, 8),
  ('stpl_09', '주말 근무', '주말', '11:00', '18:00', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '#4D5656', NULL, 9),
  ('stpl_10', '주말근무', '주말근무', '12:00', '17:00', ARRAY['영통']::TEXT[], ARRAY['매니저','원장']::TEXT[], '#aed6f1', NULL, 10),
  ('stpl_11', '학기중(1:30-10:30)', '교실장', '13:30', '22:30', ARRAY['영통']::TEXT[], ARRAY['매니저']::TEXT[], '#d7bde2', NULL, 11),
  ('stpl_12', NULL, '8 - 1:30 서현 코디님_방학근무', '08:00', '13:30', ARRAY['분당서현']::TEXT[], ARRAY[]::TEXT[], '#16A085', NULL, 12),
  ('stpl_13', NULL, '방학코디', '08:00', '14:00', ARRAY['분당서현']::TEXT[], ARRAY[]::TEXT[], '#9A7D0A', NULL, 13),
  ('stpl_14', NULL, '방학코디', '08:00', '15:30', ARRAY['분당수내']::TEXT[], ARRAY[]::TEXT[], '#922B21', NULL, 14),
  ('stpl_15', NULL, '오전9시', '09:00', '18:00', ARRAY['잠실']::TEXT[], ARRAY['코디']::TEXT[], '#a569bd', NULL, 15),
  ('stpl_16', NULL, '서현코디님', '10:00', '15:30', ARRAY['분당서현']::TEXT[], ARRAY[]::TEXT[], '#F5B7B1', NULL, 16),
  ('stpl_17', NULL, '방학코디', '10:00', '17:30', ARRAY['분당수내']::TEXT[], ARRAY[]::TEXT[], '#34495E', NULL, 17),
  ('stpl_18', NULL, '동탄 코디님 방학', '10:00', '18:00', ARRAY['동탄']::TEXT[], ARRAY[]::TEXT[], '#BFC9CA', NULL, 18),
  ('stpl_19', NULL, '방학 10시', '10:00', '19:00', ARRAY['동탄']::TEXT[], ARRAY['매니저','상담실장','수내_코디','원장','원장대행','직영사업본부','컨설턴트','코디','학습실장']::TEXT[], '#AF7AC5', NULL, 19),
  ('stpl_20', NULL, '방학 10-7', '10:00', '19:00', ARRAY['분당서현','분당수내','분당야탑','분당야탑 2관']::TEXT[], ARRAY[]::TEXT[], '#78281F', NULL, 20),
  ('stpl_21', NULL, '10-7', '10:00', '19:00', ARRAY['봉천']::TEXT[], ARRAY[]::TEXT[], '#943126', NULL, 21),
  ('stpl_22', NULL, '주말 11-6:30', '11:00', '18:30', ARRAY['분당야탑','분당야탑 2관']::TEXT[], ARRAY[]::TEXT[], '#566573', NULL, 22),
  ('stpl_23', NULL, '방학 11시 출근', '11:00', '20:00', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '#5D6D7E', NULL, 23),
  ('stpl_24', NULL, '동탄코디님', '13:00', '21:00', ARRAY['동탄']::TEXT[], ARRAY[]::TEXT[], '#873600', NULL, 24),
  ('stpl_25', NULL, '학기중(13:00~22:00)', '13:00', '22:00', ARRAY[]::TEXT[], ARRAY[]::TEXT[], '#5b2c6f', NULL, 25),
  ('stpl_26', NULL, '연간총회', '13:00', '22:00', ARRAY['잠실']::TEXT[], ARRAY['매니저']::TEXT[], '#2E4053', NULL, 26),
  ('stpl_27', NULL, '수내점 코디님 2시출근', '14:00', '21:30', ARRAY['분당수내']::TEXT[], ARRAY[]::TEXT[], '#F4D03F', NULL, 27),
  ('stpl_28', NULL, '서현_코디', '15:00', '20:30', ARRAY['분당서현']::TEXT[], ARRAY['코디']::TEXT[], '#B2BABB', NULL, 28),
  ('stpl_29', NULL, '학기중서현코디님', '15:00', '20:30', ARRAY['분당서현']::TEXT[], ARRAY[]::TEXT[], '#5D6D7E', NULL, 29),
  ('stpl_30', NULL, '서현코디님', '15:00', '21:00', ARRAY['분당서현']::TEXT[], ARRAY[]::TEXT[], '#F1948A', NULL, 30),
  ('stpl_31', NULL, '이주은교실장단축', '15:00', '22:00', ARRAY['분당서현']::TEXT[], ARRAY[]::TEXT[], '#AF601A', NULL, 31),
  ('stpl_32', NULL, '수내점 코디님 3시출근', '15:00', '22:00', ARRAY['분당수내']::TEXT[], ARRAY[]::TEXT[], '#D4AC0D', NULL, 32),
  ('stpl_33', NULL, '압구정_계약직', '17:00', '21:30', ARRAY['압구정']::TEXT[], ARRAY[]::TEXT[], '#EC7063', NULL, 33),
  ('stpl_34', NULL, '10 - 3:30 서현 코디님 _방학근무', '10:00', '15:30', ARRAY['분당서현']::TEXT[], ARRAY[]::TEXT[], '#6E2C00', NULL, 34)
ON CONFLICT ("id") DO NOTHING;
COMMIT;
