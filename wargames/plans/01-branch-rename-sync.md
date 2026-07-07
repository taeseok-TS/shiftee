# 워게임 01 — 지점명 실제화 + 이름 변경 동기화

> 실행자에게: 이것은 계획이 아니라 워게임이다. 각 수(move)의 "예상 관찰"과 실제 관찰이
> 다르면 명시된 분기를 따르고, 중단 조건에 걸리면 즉시 멈추고 보고하라.
> `wargames/success.md`의 공통 성공 기준이 함께 적용된다.

## 0. 정찰 결과 (2026-07 검증 완료 — 재확인 불필요, 단 파일이 바뀌었으면 재정찰)

이 미션이 위험한 이유는 `Branch.name`이 사실상 **암묵적 외래키**이기 때문이다. 결합 지점:

1. **`User.branch String?`** — Branch.name과 문자열 매핑 (schema.prisma의 User 모델). FK 아님.
2. **JWT 세션 클레임** — `lib/auth.ts`의 세션 payload가 `{ userId, email, name, role, branch }`.
   로그인 시점의 지점명이 토큰에 **박제**된다. 이름을 바꿔도 기존 토큰은 옛 이름을 들고 다닌다.
3. **27개 API 파일이 `session.branch`로 필터** — attendance(5), employees(5), approval-line(2),
   leave(5), contracts(3), schedule(2), schedule-requests(2), work/calendar(2),
   manager/dashboard-stats(1). 특히:
   - `api/attendance/clock-in/route.ts:27-29` — 지오펜스가
     `prisma.branch.findFirst({ where: { name: session.branch, isActive: true } })`로 지점을 찾는다.
     **세션의 옛 이름으로 조회 → 지점 못 찾음 → 지오펜스 미적용(무조건 통과)으로 조용히 열린다.**
     이것이 이 미션의 가장 위험한 침묵 실패(silent failure)다.
4. **`PATCH /api/branches/[id]`** (`api/branches/[id]/route.ts:25-43`) — 이름 중복 검사 후
   `prisma.branch.update`만 수행. User.branch 동기화 없음.
5. 소프트 삭제(`isActive: false`, 62행)도 소속 직원 처리 없음 — 이번 미션 범위 밖이지만
   같은 패턴이므로 발견 사항으로만 보고.

## 1. 수순 (Moves)

### Move 1 — 동기화 로직 구현 (`PATCH /api/branches/[id]`)

이름이 변경되는 경우(기존 `name !== 새 name`)에 한해 `prisma.$transaction`으로:
1. `branch.update` (이름 변경)
2. `user.updateMany({ where: { branch: 기존이름 }, data: { branch: 새이름 } })`
3. `logAudit` — action `BRANCH_RENAME`, detail에 `"A지점→강남점, 직원 12명 동기화"` 형식

- **예상 관찰(성공)**: 지점명 변경 API 호출 → 응답에 갱신된 branch + 영향 직원 수.
  DB에서 `SELECT count(*) FROM "User" WHERE branch = '기존이름'` = 0.
- **예상 관찰(실패)**: 트랜잭션 에러, 또는 count > 0 (동기화 누락).
- **가장 가능성 높은 실패**: `updateMany`의 where를 `session.branch`나 새 이름으로 잘못 잡아
  0명 갱신. **신호**: 응답의 영향 직원 수가 0인데 그 지점에 직원이 있음.
  **대응 수**: 변경 *이전* 이름을 트랜잭션 시작 전에 `branch.findUnique`로 확보해 두고 그걸로 매칭.
- **주의**: 퇴직자(`isActive: false`)의 `User.branch`도 함께 갱신할 것 — 퇴직자 현황 화면이
  지점명으로 그룹핑할 수 있으므로 재직자만 갱신하면 반쪽 동기화가 된다.

### Move 2 — 스테일 세션 완화

이름 변경 후에도 로그인 중 사용자의 토큰에는 옛 지점명이 남는다. 재로그인 전까지:
- MANAGER: 자기 지점 필터가 빈 결과 (성가시지만 안전한 실패)
- EMPLOYEE: **지오펜스가 조용히 꺼짐** (위험한 실패 — 정찰 3번 항목)

완화책 두 가지 중 택일 (분기 트리거: 아래 참조):

**경로 A (권장, 작음)**: `clock-in`/`clock-out`에서 지점 조회를 세션이 아닌 DB 기준으로 변경 —
`session.branch` 대신 `prisma.user.findUnique({ where: { id: session.userId }, select: { branch: true } })`
결과로 Branch를 찾는다. 출퇴근 2개 라우트만 수정. 나머지 25개 파일의 조회-필터는
"재로그인까지 빈 목록"이라는 안전한 실패이므로 건드리지 않는다 (외과적 변경 원칙).

**경로 B (큼)**: 세션 payload에서 branch를 빼고 매 요청 DB 조회로 전환. 27개 파일 수정.
회귀 반경이 너무 넓다 — 사용자가 명시적으로 요구할 때만.

- **분기 트리거**: 기본은 경로 A. 단, `lib/auth.ts`를 열었을 때 세션에 이미 DB 재조회
  헬퍼가 존재하면 그것을 재사용하는 변형 A'로.
- **예상 관찰(성공)**: 지점명 변경 직후, 재로그인 없이 그 지점 직원 계정으로 출근 시도 →
  지오펜스가 여전히 작동 (반경 밖이면 거리/반경 에러 메시지).
- **가장 가능성 높은 실패**: user.branch는 새 이름인데 Branch 조회를 여전히 `session.branch`로
  하는 코드 경로가 남음. **신호**: 반경 밖 좌표로 출근했는데 성공함.
  **대응 수**: clock-in/clock-out 두 파일에서 `session.branch` 사용처를 grep으로 전수 확인.

### Move 3 — 일괄 이름 교체 (A~O → 실제 지점명)

**전제**: ledger의 `(실제_지점명_매핑)`이 채워져 있어야 함. 비어 있으면 Move 1~2까지만
완료하고 중단 조건 C1에 따라 보고.

- 교체는 새 스크립트가 아니라 **Move 1에서 만든 PATCH API를 지점별로 호출**하거나,
  같은 트랜잭션 로직을 재사용하는 관리자용 일괄 실행으로. 동기화 로직을 우회하는
  직접 UPDATE 스크립트 금지 (로직 이원화 방지).
- 실행 순서: 백업 확인 → 15개 순차 실행 → 각각의 영향 직원 수 합계가 재직+퇴직 전체
  직원 수와 대조.
- **가장 가능성 높은 실패**: 새 이름이 기존 이름과 충돌 (중복 검사에 걸림 — 25행).
  예: "B지점"→"강남점"인데 "강남점"이 이미 존재. **신호**: 409/400 응답.
  **대응 수**: ledger의 `(지점명_중복_정책)`을 따르되 미정의면 해당 지점만 건너뛰고 보고.
- **2차 결과(second-order)**: `User.branch`가 매핑표에 없는 값(오타, 옛 지점, NULL)인 직원 존재
  가능. 교체 전에 `SELECT DISTINCT branch FROM "User"`로 고아 값 목록을 뽑아 보고에 포함.

## 2. 검증

1. 테스트 지점 1개 이름 변경 → 해당 지점 MANAGER로 재로그인 → 직원 목록/출퇴근 조회 정상.
2. 재로그인 **없이** (변경 전 토큰으로) 그 지점 직원의 출근 시도 → 지오펜스 여전히 작동 (Move 2 검증).
3. 소비처 회귀 2곳: `/employees` 지점 카드 목록, `/api/attendance/today-list`.
4. 감사 로그에 BRANCH_RENAME 행 존재.

## 3. 중단 조건 (Abort)

- **C1**: `(실제_지점명_매핑)` 미입력 → Move 3 실행 금지. Move 1~2만 완료 보고.
- **C2**: 운영 DB 백업 미확인 상태에서 15개 일괄 교체 금지.
- **C3**: `lib/auth.ts`의 세션 구조가 정찰과 다름 (branch 클레임이 없음 등) → 전제가 무너진 것.
  재정찰 결과를 보고하고 지시 대기.
- **C4**: `prisma.$transaction`이 이 코드베이스에서 한 번도 안 쓰였고 시도 시 클라이언트
  에러 발생 (구버전 등) → 순차 실행 + 실패 시 수동 롤백 로직으로 격하하지 말고 보고 먼저.
