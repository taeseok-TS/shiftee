# 워게임 02 — 연차 연도 전환 (신년도 LeaveBalance 생성/이월)

> 실행자에게: 워게임 규칙은 `wargames/README.md`, 공통 성공 기준은 `wargames/success.md` 참조.

## 0. 정찰 결과 (2026-07 검증 완료)

1. **스키마가 연도 이력을 허용하지 않는다**: `LeaveBalance.userId`가 `@unique`
   (schema.prisma 212-222행 부근). 유저당 1행, `year Int`는 단순 컬럼.
   "신년도 행 생성"은 현 스키마로는 **불가능** — 스키마 변경이 이 미션의 관문이다.
2. 같은 행을 쓰는 기존 코드 (전부 `where: { userId }` 단독 조회 — 스키마 변경 시 전원 영향):
   - `POST /api/leave` (`api/leave/route.ts:160-165` 부근) — 신청 시
     `upsert({ where: { userId }, update: { used: { increment: days }, remaining: { decrement: days } } })`
   - `POST /api/leave/[id]/approve` — 반려/복원 시 차감 복구 (동일 패턴 예상, 실행 전 확인)
   - `GET/PATCH /api/leave/balance` (`api/leave/balance/route.ts`) — 조회는
     `findUnique({ where: { userId } })`, 수동 조정은 `upsert({ where: { userId } })`
   - `POST /api/leave/balance/recalc` — 근속 기반 `annualLeaveDays()`로 total/remaining 덮어쓰기
3. 근속 계산 유틸: `lib/leave-calc.ts`의 `annualLeaveDays(hire, asOf)` — 근로기준법
   (1년 미만 월 1일 최대 11, 1~2년 15, 3년+ 15+floor((y-1)/2) 최대 25).
4. 실행 인프라: Windows 개인 PC에서 수동 기동하는 서버 (CLAUDE.md) — cron/스케줄러 전제 불가.
   **관리자 수동 버튼**이 기본 경로 (ledger `(전환_시점)`).
5. 감사 로그 인프라 존재: `logAudit()` — balance PATCH가 이미 사용 중 (모범 패턴).

## 1. 설계 결정 (실행 전 확정)

**스키마**: `@unique`를 `@@unique([userId, year])` 복합 유니크로 교체. 이것이 유일한
현실적 선택지다 — 별도 이력 테이블은 조회 코드 이원화를 낳고, JSON 스냅샷은 조회 불가.

**이월 정책**: ledger `(이월_정책)` 미입력 시 기본값 = **소멸 + 신년도 재부여**
(신년 total = `annualLeaveDays(hireDate, 신년 1월 1일)`, used = 0).

## 2. 수순 (Moves)

### Move 1 — 스키마 변경 + 기존 코드 마이그레이션

`userId @unique` 제거, `@@unique([userId, year])` 추가. 그 다음 **컴파일이 강제하는
수정을 전부 따라간다**: `findUnique({ where: { userId } })`와 `upsert({ where: { userId } })`가
전부 깨진다 → `where: { userId_year: { userId, year } }`로 교체. 이때 각 호출부의
"올해"를 어디서 얻는지 통일할 것 (`new Date().getFullYear()` — 서버 로컬 타임존.
KST 운영 전제이므로 그대로 두되, 12월 31일 밤 UTC 경계 이슈는 발견 사항으로만 보고).

- **예상 관찰(성공)**: `prisma db push` 성공, `tsc --noEmit`(또는 `next build`) 통과,
  기존 데이터 보존 (`db push`는 유니크 제약만 바꾸므로 데이터 유지).
- **가장 가능성 높은 실패**: `db push`가 유니크 제약 변경 시 기존 중복 데이터로 거부 —
  (userId, year) 중복은 현 스키마상 불가능하므로 이론상 안전하지만,
  **신호**: "unique constraint" 에러. **대응 수**: 중복 행 조회 후 보고 (임의 삭제 금지).
- **2차 결과**: `where: { userId }` 패턴을 놓친 호출부는 컴파일이 아닌 **런타임**에 깨질 수
  있다 (findFirst 등 유연한 API). **대응 수**: `leaveBalance`로 grep 전수 조사 —
  컴파일러만 믿지 말 것.
- **주의 (CLAUDE.md)**: 개발 서버 실행 중에는 Windows DLL 락으로 `prisma generate` 불가 —
  스키마 변경 전 서버 종료.

### Move 2 — 연도 전환 API (`POST /api/leave/rollover` 또는 balance 하위)

권한: ADMIN 전용 (recalc는 MANAGER도 허용하지만, 전환은 전사 1회성 작업이므로 좁게).
로직, 재직자 전원에 대해:
1. 대상 연도(기본: 현재 연도)의 행이 이미 있으면 건너뜀 → **멱등성**
2. 없으면 생성: `total = annualLeaveDays(hireDate, new Date(year, 0, 1))`, used 0,
   이월 정책 적용 시 remaining에 전년도 잔여 가산
3. `hireDate` 없는 직원은 total 15 기본값 (recalc와 동일 관례) — 목록을 응답에 포함해 보고
4. `logAudit` — action `LEAVE_ROLLOVER`, detail에 "2027년도 전환, 생성 N명, 건너뜀 M명"

- **예상 관찰(성공)**: 1회 실행 → `{ created: N, skipped: 0 }`, 재실행 → `{ created: 0, skipped: N }`.
- **가장 가능성 높은 실패**: 전년도 행을 찾을 때 연도 불일치로 이월분 0 처리.
  **신호**: 이월 정책인데 신년 remaining이 total과 동일. **대응 수**: 전년도 행 존재 여부를
  응답에 노출해 눈으로 검증 가능하게.
- **경합**: 전환 실행 중 직원이 휴가 신청 → 신청 로직의 upsert가 신년도 행을 total 15로
  먼저 만들어버릴 수 있음 (`api/leave/route.ts:162` create 분기). **대응 수**: rollover의
  "이미 있으면 건너뜀"이 이 행을 덮어쓰지 않으므로 데이터 손실은 없지만, total이 15로
  굳는다 → 건너뜀 목록에 사유를 담아 관리자가 recalc로 보정하도록 안내 문구.

### Move 3 — UI (관리자 연차 화면에 전환 버튼)

`admin` 연차/휴가 관리 화면에서 recalc 버튼이 이미 있는 위치를 찾아 그 옆에 배치.
확인 다이얼로그 필수 ("2027년도로 전환합니다. 전년도 잔여는 [정책]됩니다").

- **분기 트리거**: recalc 버튼이 UI에 없으면 (API만 존재) → 버튼 2개를 나란히 새로 만들지
  말고 전환 버튼만 추가. 기존 UI 관례(카드/다이얼로그 컴포넌트)를 따를 것.

### Move 4 — 조회 화면의 연도 처리

`GET /api/leave/balance`의 관리자 목록이 이제 (userId, year) 기준이므로 연도 파라미터를
받아야 함. 기본값은 현재 연도 — 기존 화면은 무수정으로 동작해야 한다 (하위 호환).
전년도 조회 UI(연도 셀렉터)는 **요구되지 않았으면 만들지 않는다** (심플리시티 원칙).
데이터만 보존되면 성공 조건 충족.

## 3. 검증

1. 테스트 직원으로: 전환 실행 → 신년도 행 생성 확인 → 휴가 신청 → used 증가 →
   반려 → used 복원. 전 과정이 **신년도 행**에서 일어남을 DB로 확인.
2. 멱등성: 전환 2회 실행 → 두 번째는 전원 건너뜀, 데이터 불변.
3. 회귀 2곳: 직원 본인의 잔여 연차 표시 화면, `PATCH /api/leave/balance` 수동 조정.
4. 감사 로그 확인.

## 4. 중단 조건 (Abort)

- **C1**: `db push`가 데이터 손실 경고를 내며 `--accept-data-loss`를 요구 → 실행하지 말고
  경고 원문을 보고.
- **C2**: `leaveBalance` grep 결과 정찰에 없던 소비처가 5곳 이상 발견 (모바일 앱 API 등) →
  영향 범위 재산정 보고 후 진행 여부 확인.
- **C3**: 운영 DB 백업 미확인 → 스키마 변경 금지.
