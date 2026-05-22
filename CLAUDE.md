# Behavioral Guidelines (Andrej Karpathy Skills)

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project: 시프티 (Shiftee)

HR 관리 시스템 — Next.js 16 (App Router) + Prisma + PostgreSQL + Expo React Native 모노레포.

## 구조

```
apps/web      — Next.js 웹 대시보드
apps/mobile   — Expo React Native 앱 (미구현)
packages/db   — Prisma 스키마 공유
```

## 환경 / 실행

- 경로 문제: 한글 경로 우회용 junction → `C:\shiftee` (원본: `C:\Users\N-88\Documents\시프티`)
- 서버 시작 (PowerShell):
  ```powershell
  Get-Process -Name "node" | Stop-Process -Force
  Start-Process -FilePath "node.exe" -ArgumentList '"C:\shiftee\apps\web\node_modules\next\dist\bin\next" dev' -WorkingDirectory "C:\shiftee\apps\web" -WindowStyle Hidden
  ```
- DB: `postgresql://postgres:password@localhost:5432/shiftee`
- Prisma push: `$env:DATABASE_URL="postgresql://postgres:password@localhost:5432/shiftee"; node node_modules\prisma\build\index.js db push`
- 스키마 변경 후 반드시 서버 재시작 (Windows DLL 락으로 generate 불가)
- 관리자 계정: `admin@shiftee.com` / `admin1234`

## 주요 주의사항

- Next.js 16.2.6 — params는 `Promise<{ id: string }>` 타입, `await params`로 사용
- Prisma 스키마 변경 시 `prisma db push` 사용 (migrate dev는 히스토리 충돌)
- 개발 서버 실행 중에는 `prisma generate` 불가 (Windows DLL 락)
- 한글 경로(`시프티`) — PowerShell에서 한글 깨짐 주의, junction 경유 사용
- `branch String?` on User — Branch 모델의 `name`과 문자열로 매핑 (FK 아님)

---

# 현재 구현 상태 (2025-05 기준)

## ✅ 완료된 기능

### 인증
- JWT 세션 (`jose`) — `getSession()` in `lib/auth.ts`
- payload: `{ userId, email, name, role, branch }`
- 로그인/로그아웃 API

### DB 스키마 (`prisma/schema.prisma`)
```
User          — id, email, password, name, phone, role(ADMIN/MANAGER/EMPLOYEE),
                department, jobGroup, position, branch, hireDate, isActive
Attendance    — userId, date, clockIn, clockOut, status, latitude, longitude
Schedule      — userId, date, startTime, endTime, type
LeaveRequest  — userId, type, startDate, endDate, days, reason, status, approvalSteps[]
LeaveBalance  — userId, year, total, used, remaining
Contract      — userId, title, type, fileUrl, status
ApprovalLine  — userId → steps[]
ApprovalLineStep — approvalLineId, order, approverId
LeaveApprovalStep — leaveRequestId, order, approverId, status(WAITING/PENDING/APPROVED/REJECTED)
Branch        — name(unique), address, latitude, longitude, radius(m), isActive
```

### 직원 관리 (`/employees`)
- **지점 카드 목록** → 클릭하면 해당 지점 직원 상세 뷰
- 상세 뷰: 직군별 그룹(원장/CM/TM/코디) + 검색 + 직군 필터 + 수정
- 직군/직급 구조:
  - 원장: [원장]
  - CM(매니저): 인턴매니저, 매니저, 주임매니저, 선임매니저, 부원장, 수석부원장
  - TM(교실장): 인턴교실장, 교실장, 주임교실장, 선임교실장, 부원장, 수석부원장
  - 코디: [코디]
- MANAGER: 자기 지점만 보임, role/branch 변경 불가
- ADMIN: 전체, 지점 변경 가능

### 지점 관리 (`/branches`)
- 15개 지점 A~O 등록됨 (실제 이름으로 교체 필요)
- 지점별: 지점명, 주소, GPS 좌표(위도/경도), 허용 반경(50~300m)
- "현재 위치" 버튼으로 브라우저 GPS 좌표 자동 입력
- 좌표 미설정 지점은 지오펜스 미적용

### 출퇴근 (`/attendance`)
- 출근/퇴근 버튼 → 브라우저 GPS 자동 취득 → API 전송
- 서버에서 Haversine 거리 계산, 반경 초과 시 에러 (거리/반경 표시)
- ADMIN은 지오펜스 제외
- 기간별 통계 (일/주/월/분기/반기/연간), 차트
- MANAGER: 자기 지점 구성원만 조회 가능

### 휴가 관리 (`/leave`)
- 연도+월 필터
- 결재라인: Admin이 직원별 결재자(순서 지정) 설정
- 휴가 상신 시 결재라인 순서대로 LeaveApprovalStep 생성
- 단계별 결재 (WAITING→PENDING→APPROVED/REJECTED)
- 내 결재함 탭 (PENDING 건 배지)
- MANAGER: 자기 지점만 조회

### 근무일정 (`/schedule`)
- MANAGER: 자기 지점 구성원만 조회

### API 목록
```
GET/POST   /api/employees
PATCH/DEL  /api/employees/[id]
GET/POST   /api/branches
PATCH/DEL  /api/branches/[id]
POST       /api/attendance/clock-in   ← 지오펜스 체크
POST       /api/attendance/clock-out  ← 지오펜스 체크
GET        /api/attendance
GET        /api/attendance/stats
GET/POST   /api/leave
POST       /api/leave/[id]/approve
GET        /api/leave/my-approvals
GET/PUT    /api/approval-line
PUT        /api/approval-line/[userId]
GET/POST   /api/schedule
GET        /api/schedule/day
GET        /api/leave/balance
GET/POST   /api/auth/login|logout|me
```

---

## 🔲 미구현 / 남은 작업

### 웹 대시보드
- [ ] **전자계약** — 계약서 업로드/발송/서명 플로우 (현재 기본 UI만)
- [ ] **대시보드** — 홈 화면 요약 위젯 (출퇴근 현황, 오늘 일정, 결재 대기 등)
- [ ] **지점명 실제화** — A~O지점 → 실제 지점명으로 교체 + 직원 branch 매핑
- [ ] **직원 비활성화(퇴직)** — DELETE API 있으나 UI 없음
- [ ] **연차 잔여 수동 조정** — 관리자가 직원 연차 total/remaining 수정
- [ ] **출퇴근 수동 수정** — 관리자가 특정 날짜 출퇴근 기록 편집
- [ ] **알림** — 결재 요청/승인/반려 알림 (이메일 or 인앱)

### 모바일 앱 (Expo React Native)
- [ ] 전체 미구현
- [ ] 출퇴근 (GPS 지오펜스), 휴가 신청, 내 결재함, 일정 조회 우선순위

### 기타
- [ ] **지점 이름 변경 시** User.branch 동기화 (현재 FK 아닌 문자열 매핑)
- [ ] **다음 연도 연차 이월** — 연초 LeaveBalance 자동 생성 로직
- [ ] **공휴일 연동** — 한국 공휴일 API 연동
