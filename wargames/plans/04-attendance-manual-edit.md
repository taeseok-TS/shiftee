# 워게임 04 — 출퇴근 기록 수동 수정 (관리자)

> 실행자에게: 워게임 규칙은 `wargames/README.md`, 공통 성공 기준은 `wargames/success.md` 참조.

## 0. 정찰 결과 (2026-07 검증 완료)

1. **기존 수정 경로는 auto-fill 하나뿐**: `PATCH /api/attendance/[id]/auto-fill`
   (`api/attendance/[id]/auto-fill/route.ts`) — 출근만 있으면 퇴근=출근+9h, 퇴근만 있으면
   출근=퇴근-9h. ADMIN 전용 (17-18행, 직원의 자기 보정 방지 주석 있음).
2. **상태 판정 로직이 인라인**: 같은 파일 47-50행 —
   `isLate = clockIn.getHours() > 9 || (getHours() === 9 && getMinutes() > 0)`,
   `isEarlyLeave = clockOut.getHours() < 18`, status = LATE / EARLY_LEAVE / NORMAL.
   주의: **LATE가 EARLY_LEAVE보다 우선** (지각+조퇴면 LATE). 새 코드도 이 우선순위를 보존할 것.
3. `Attendance` 모델: userId, date, clockIn, clockOut, status, latitude, longitude
   (+ AttendanceStatus enum, schema.prisma 70-95행 부근). **수동 수정 시 latitude/longitude는
   건드리지 않는다** — GPS 기록은 실측 값이므로 보존 (수정된 기록임은 감사 로그가 증명).
4. UI: 관리자 출퇴근 화면은 `admin/attendance/page.tsx`. auto-fill 버튼이 이미 있을
   가능성이 높음 — 실행 시 이 화면의 기존 패턴(모달/테이블)을 관찰하고 따를 것.
5. 감사 로그 인프라: `logAudit()` (`lib/audit.ts`) — leave/balance PATCH의 사용례가 모범
   (변경 전→후를 detail에 기록).
6. 통계는 `GET /api/attendance/stats`가 DB를 직접 집계하므로 수정이 자동 반영될 것으로
   예상 — 단, 캐시가 있다면 깨진다 (실행 시 확인, 분기 트리거 아래).

## 1. 수순 (Moves)

### Move 1 — 상태 판정 로직 공용화

auto-fill 47-50행의 판정을 `lib/attendance-status.ts` 같은 유틸로 추출:
`calcStatus(clockIn: Date | null, clockOut: Date | null): AttendanceStatus`.
auto-fill이 이 함수를 쓰도록 교체 — **동작 불변** (리팩터링 전후 같은 입력, 같은 출력).

- **예상 관찰(성공)**: auto-fill 기존 시나리오(퇴근 누락 보정)가 이전과 동일한 status 산출.
- **가장 가능성 높은 실패**: LATE/EARLY_LEAVE 우선순위 뒤바뀜, 또는 null 처리 차이.
  **신호**: 지각+조퇴 기록이 EARLY_LEAVE로 나옴. **대응 수**: 추출 함수에 우선순위를
  주석으로 명시하고 기존 코드와 삼항 구조를 그대로 옮길 것 (개선 금지).
- **주의**: clock-in/clock-out 라우트에도 유사 판정이 인라인으로 있으면 — **이번 미션에서는
  통합하지 않는다** (외과적 변경 원칙). 발견 사실만 보고서에 기록. 단, 미션 03의 Move 5
  (공휴일 판정 제외)가 이미 반영돼 있으면 추출 함수에 그 로직도 함께 옮겨야 회귀가 없다.

### Move 2 — 수정 API (`PATCH /api/attendance/[id]`)

기존 `[id]` 폴더에는 auto-fill만 있음 → `api/attendance/[id]/route.ts` 신설.
- 권한: ADMIN 전용 (ledger `(수정_권한_범위)` 기본값, auto-fill의 17-18행 주석 근거 동일).
- 입력: `{ clockIn?: string | null, clockOut?: string | null }` — ISO 문자열 또는 명시적 null(삭제).
- 검증 (400 거부):
  - 둘 다 null이 되는 결과 (기록 무의미화 — 이 경우는 별도 삭제 정책이므로 거부)
  - `clockOut < clockIn`
  - 파싱 불가 문자열
  - **날짜 불일치**: 수정된 clockIn/clockOut의 날짜가 기록의 `date`와 다른 날 —
    이것이 가장 흔한 관리자 실수 (야간 근무가 아니라면). 자정 넘는 근무를 지원해야 하는지는
    현 데이터로 판단: 기존 기록 중 clockOut 날짜 ≠ date인 행이 있으면 허용(경고만),
    없으면 거부. **분기 트리거이므로 실행 시 DB를 먼저 조회할 것.**
- 처리: 값 갱신 + `calcStatus`로 status 재계산 + `logAudit`
  (action `ATTENDANCE_EDIT`, detail `"홍길동 2026-07-01 출근 09:12→08:55"` 형식).
- **가장 가능성 높은 실패**: 타임존 — 클라이언트가 보낸 "09:00"이 UTC로 파싱되어 KST 18:00
  판정이 어긋남. **신호**: 09:00로 수정했는데 status가 LATE/이상값. **대응 수**: 프론트에서
  ISO 8601 오프셋 포함 문자열(`2026-07-01T09:00:00+09:00`)로 보내고, 서버는 Date 파싱만.
  기존 clock-in이 `new Date()` 서버 시각을 쓰는 방식과 결과가 일치하는지 실제 기록으로 대조.

### Move 3 — 기록 생성 API (기록 없는 날짜)

ledger `(기록_생성_허용)` 기본값: 허용. `POST /api/attendance` — 단, **기존
`api/attendance/route.ts`에 이미 POST가 있는지 먼저 확인** (정찰상 GET만 확인됨).
- 입력: `{ userId, date, clockIn?, clockOut? }`. 검증은 Move 2와 동일 +
  같은 (userId, date) 기록 존재 시 409 (중복 방지 — 스키마에 유니크 제약이 없다면
  race 가능성은 낮으므로 조회-후-생성으로 충분, 제약 추가는 하지 않는다).
- GPS 좌표는 null로 생성 (실측이 아니므로).
- **2차 결과**: 수동 생성된 기록은 지오펜스를 우회한 기록이다 — status만으로는 구분 불가.
  감사 로그가 유일한 구분자이므로 생성도 반드시 `logAudit` (action `ATTENDANCE_CREATE`).

### Move 4 — UI (관리자 출퇴근 화면)

`admin/attendance/page.tsx`의 기존 테이블 행에 수정 진입점 추가. 기존 화면의 모달/다이얼로그
관례를 따를 것 (shadcn/ui dialog가 `components/ui/`에 있음).
- 시각 입력은 `<input type="time">` 수준이면 충분 — 날짜는 기록의 date 고정.
- auto-fill 버튼이 이미 있으면 그 옆에 나란히, 없으면 행 액션으로.
- **분기 트리거**: 이 화면이 서버 컴포넌트 기반이라 클라이언트 상태가 없으면 —
  기존 데이터 로딩 방식(fetch 패턴)을 관찰하고 동일하게. 화면 구조 개편 금지.

## 2. 검증

1. 정상 기록의 출근 시각을 09:30으로 수정 → status가 LATE로 재계산, 목록/통계에 반영.
2. 08:50으로 재수정 → NORMAL 복귀.
3. `clockOut < clockIn` 입력 → 400 + 한국어 에러 메시지.
4. 기록 없는 날짜에 생성 → 목록에 나타남, 같은 날짜 재생성 → 409.
5. 회귀: auto-fill 시나리오(퇴근 누락 → 보정) 기존 동작 불변. `GET /api/attendance/stats`
   기간 통계가 수정 반영.
6. 감사 로그에 ATTENDANCE_EDIT / ATTENDANCE_CREATE 행, 변경 전→후 포함.
7. EMPLOYEE 계정으로 PATCH 호출 → 403.

## 3. 중단 조건 (Abort)

- **C1**: `api/attendance/route.ts`에 이미 POST/PATCH가 존재하고 이 워게임과 다른 의미로
  동작 → 중복 API를 만들지 말고 기존 것의 실체를 보고 후 대기.
- **C2**: Attendance에 (userId, date) 중복 행이 이미 다수 존재 (데이터가 "하루 1행" 전제를
  깸) → 수정 UI의 대상 특정이 불가능해짐. 중복 현황 보고 후 대기.
- **C3**: 타임존 대조(Move 2)에서 기존 기록과 새 수정 경로의 시각 해석이 일치하지 않음 →
  임의 보정하지 말고 관찰 결과 보고.
