# Shiftee HR 시스템 - 프로젝트 현황

**마지막 업데이트:** 2026-05-29

---

## 📋 완료된 기능

### ✅ 계약서 관리 시스템

#### 1. 기본 기능
- ✅ 계약서 생성 (파일 업로드)
- ✅ 계약서 수정 (DRAFT 상태에서만)
- ✅ 계약서 삭제 (DRAFT 상태에서만, 관리자)
- ✅ 계약서 조회 (권한별 필터링)
- ✅ 파일 업로드 (MultipartFormData 지원)

#### 2. 결재 시스템
- ✅ 결재 순서 설정 (동적, 직원 포함 가능)
- ✅ 결재 상태 관리 (DRAFT → SENT → APPROVED → SIGNED)
- ✅ 결재 권한 관리 (ADMIN, MANAGER만 발송 가능)
- ✅ 결재 진행 상태 표시

#### 3. 결재 흐름 (최근 수정)
- ✅ 첫 번째 PENDING 단계 담당자에게 초기 이메일 발송
- ✅ 각 단계별 승인 후 다음 담당자에게 순차적 이메일 발송
- ✅ 최종 완료 후 직원에게 완료 이메일 발송
- ✅ 원장 → 직원 → 관리자 순서 지원
- ✅ 직원 → 원장 → 관리자 순서 지원
- ✅ 기타 모든 순서 조합 지원

#### 4. 계약 기간 관리
- ✅ 시작일/종료일 필드 추가
- ✅ 계약 기간 표시

#### 5. 결재 이력
- ✅ 각 단계별 승인자, 상태, 승인 일시 기록
- ✅ 히스토리 모달에서 조회 가능

#### 6. 추가 기능 (계획 수립됨)
- ⏳ 계약서 버전 관리
- ⏳ 계약서 템플릿
- ⏳ 결재 회수 기능
- ⏳ 결재 대상자 수정 기능

---

### ✅ 직원 관리 시스템

#### 1. 기본 기능
- ✅ 직원 추가
- ✅ 직원 정보 수정 (이름, 직급, 부서, 지점 등)
- ✅ 직원 삭제 (Soft delete - isActive=false)
- ✅ 직원 목록 조회 (권한별 필터링)

#### 2. 직원 정보 필드
- ✅ 기본 정보: 이름, 이메일, 연락처
- ✅ 직급 정보: 직급, 직무군 (jobGroup)
- ✅ 조직 정보: 부서, 지점
- ✅ 고용 정보: 입사일

#### 3. 추가 기능 (계획 수립됨)
- ⏳ 퇴사 처리
- ⏳ 퇴직자 현황 대시보드
- ⏳ 재직자 현황 대시보드

---

### ✅ 휴가 관리 시스템

#### 1. 기본 기능
- ✅ 휴가 신청
- ✅ 휴가 유형 (연차, 반차, 병가, 경조사 등)
- ✅ 휴가 기간 설정
- ✅ 휴가 신청 조회

#### 2. 승인 기능
- ✅ 다단계 승인 (복수 승인자)
- ✅ 승인/반려
- ✅ 휴가 현황 조회

---

### ✅ 인증 & 권한 시스템
- ✅ 로그인/로그아웃
- ✅ 역할 기반 접근 제어 (ADMIN, MANAGER, EMPLOYEE)
- ✅ 권한별 기능 제어

---

## 🔧 기술 스택

### 백엔드
- **Runtime:** Node.js 20+
- **Framework:** Next.js 16.2.6 (App Router)
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Language:** TypeScript
- **Email:** Nodemailer

### 프론트엔드
- **Framework:** React 19 (Next.js App Router)
- **UI Library:** Material-UI / Custom Components
- **State Management:** React Hooks
- **HTTP Client:** Fetch API

### DevOps
- **Package Manager:** npm / pnpm
- **Version Control:** Git
- **File Storage:** Local filesystem

---

## 📁 프로젝트 구조

```
C:\shiftee\
├── apps/
│   └── web/                          # Next.js 웹앱
│       ├── src/
│       │   ├── app/
│       │   │   ├── api/              # API 엔드포인트
│       │   │   │   ├── contracts/    # 계약서 API
│       │   │   │   ├── leave/        # 휴가 API
│       │   │   │   └── employees/    # 직원 API
│       │   │   └── (dashboard)/      # 웹 UI
│       │   ├── lib/
│       │   │   ├── auth.ts           # 인증 함수
│       │   │   ├── db.ts             # Prisma 클라이언트
│       │   │   └── email.ts          # 이메일 함수
│       │   └── types/                # TypeScript 타입
│       └── package.json
│
├── packages/
│   ├── db/
│   │   └── prisma/
│   │       ├── schema.prisma         # DB 스키마
│   │       ├── migrations/           # 마이그레이션 파일
│   │       └── seed.ts               # 초기 데이터
│   └── api/
│       └── types/                    # 공용 타입
│
└── .env.local                         # 환경변수
```

---

## 🐛 최근 버그 수정

### 2026-05-29: 계약서 결재 순서 이메일 발송 수정

**문제:**
결재 순서를 "원장 → 직원 → 관리자"로 설정해도, 이메일은 항상 직원에게 먼저 발송됨.

**근본 원인:**
`/api/contracts/[id]/route.ts`에서 계약서를 SENT 상태로 변경할 때, 항상 `updated.user.email` (직원)에게 이메일을 발송했음.

**해결책:**
- 첫 번째 PENDING 단계 찾기
- 그 단계의 담당자가 직원인지 확인
- 직원이면 `sendContractNotification()`, 아니면 `sendApprovalRequest()` 호출

**변경 파일:**
- `C:\shiftee\apps\web\src\app\api\contracts\[id]\route.ts`
  - 라인 4: `sendApprovalRequest` 임포트 추가
  - 라인 202-234: 이메일 로직 수정

---

## 📊 API 엔드포인트 목록

### 계약서 API

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/api/contracts` | 계약서 목록 조회 (권한별 필터) |
| POST | `/api/contracts` | 새 계약서 작성 (파일 업로드) |
| GET | `/api/contracts/[id]` | 계약서 상세 조회 |
| PATCH | `/api/contracts/[id]` | 계약서 수정 (파일, 정보, 결재자 설정) |
| DELETE | `/api/contracts/[id]` | 계약서 삭제 (관리자만, SIGNED 제외) |
| POST | `/api/contracts/[id]/sign` | 결재 (서명/승인) |
| GET | `/api/contracts/[id]/versions` | 버전 히스토리 (계획) |
| POST | `/api/contracts/[id]/approval-steps/[stepId]/revoke` | 결재 회수 (계획) |
| PATCH | `/api/contracts/[id]/approval-steps/[stepId]` | 결재 대상자 수정 (계획) |

### 휴가 API

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/api/leave` | 휴가 신청 목록 |
| POST | `/api/leave` | 휴가 신청 |
| GET | `/api/leave/[id]` | 휴가 신청 상세 |
| PATCH | `/api/leave/[id]` | 휴가 신청 수정 |
| POST | `/api/leave/[id]/approve` | 휴가 승인/반려 |

### 직원 API

| 메서드 | 엔드포인트 | 설명 |
|--------|-----------|------|
| GET | `/api/employees` | 직원 목록 |
| POST | `/api/employees` | 직원 추가 |
| GET | `/api/employees/[id]` | 직원 상세 |
| PATCH | `/api/employees/[id]` | 직원 정보 수정 |
| DELETE | `/api/employees/[id]` | 직원 삭제 |
| PATCH | `/api/employees/[id]/resign` | 퇴사 처리 (계획) |
| GET | `/api/employees/stats/active` | 재직자 현황 (계획) |
| GET | `/api/employees/stats/resigned` | 퇴직자 현황 (계획) |

---

## 🔍 DB 스키마 (주요 모델)

```prisma
model User {
  id              String @id @default(cuid())
  email           String @unique
  name            String
  password        String (hashed)
  role            Role    @default(EMPLOYEE)
  department      String?
  branch          String?
  jobGroup        String?
  position        String?
  isActive        Boolean @default(true)
  hireDate        DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model Contract {
  id              String @id @default(cuid())
  userId          String
  user            User   @relation(fields: [userId], references: [id])
  title           String
  type            ContractType
  fileUrl         String (JSON array)
  status          ContractStatus @default(DRAFT)
  startDate       DateTime? @db.Date
  endDate         DateTime? @db.Date
  version         Int @default(1)
  approvalLine    ContractApprovalLine?
  revocationLog   Json    @default("[]") (Array of logs)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

model ContractApprovalLine {
  id              String @id @default(cuid())
  contractId      String @unique
  contract        Contract @relation(fields: [contractId], references: [id], onDelete: Cascade)
  steps           ContractApprovalStep[]
}

model ContractApprovalStep {
  id              String @id @default(cuid())
  approvalLineId  String
  approvalLine    ContractApprovalLine @relation(fields: [approvalLineId], references: [id], onDelete: Cascade)
  approverId      String
  approver        User @relation(fields: [approverId], references: [id])
  order           Int   (1, 2, 3, ...)
  status          ApprovalStatus @default(WAITING)
  comment         String?
  decidedAt       DateTime?
}

model Leave {
  id              String @id @default(cuid())
  userId          String
  user            User   @relation(fields: [userId], references: [id])
  type            LeaveType
  startDate       DateTime @db.Date
  endDate         DateTime @db.Date
  reason          String?
  status          LeaveStatus @default(PENDING)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}

enum ContractStatus {
  DRAFT           // 작성 중
  SENT            // 발송됨
  APPROVED        // 승인 진행 중
  SIGNED          // 완료
}

enum ApprovalStatus {
  WAITING         // 대기 중 (아직 순번 안됨)
  PENDING         // 승인 대기 (현재 차례)
  APPROVED        // 승인 완료
  REJECTED        // 거절
}
```

---

## 🚀 다음 단계 (우선순위)

### Phase 1: 계약 관련 기능 확대 (1주)
1. **결재 회수 기능** - ADMIN이 이미 승인된 단계를 취소
2. **결재 대상자 수정** - WAITING 상태의 승인자를 다른 사람으로 변경
3. **계약 버전 관리** - 계약 수정 시 이전 버전 기록
4. **계약 템플릿** - 자주 사용하는 계약서 템플릿 저장/재사용

### Phase 2: 직원 관리 확대 (1주)
1. **퇴사 처리** - 직원을 삭제하지 않고 퇴사 상태로 변경
2. **재직자 현황** - 월말/연말 기준 직급별 재직인원 통계
3. **퇴직자 현황** - 월별/연간 퇴사자 통계 및 목록

### Phase 3: 휴가 이메일 알림 (3일)
1. **승인 요청 이메일** - 승인자에게 휴가 승인 알림
2. **승인 완료 이메일** - 신청자에게 최종 결과 알림
3. **거절 알림** - 반려 시 신청자에게 거절 사유 전달

### Phase 4: 모바일 앱 (2주)
1. **계약서 서명** - 모바일에서 계약서 조회 및 서명
2. **출퇴근** - GPS 기반 출퇴근 기록
3. **휴가 신청** - 모바일에서 휴가 신청

---

## 📝 개발 가이드

### 로컬 개발 환경 설정

```bash
# 의존성 설치
cd C:\shiftee
npm install
# 또는
pnpm install

# 환경변수 설정
cp .env.example .env.local
# .env.local 파일에서 다음 항목 수정:
# - DATABASE_URL: PostgreSQL 연결 문자열
# - NEXTAUTH_SECRET: 임의의 긴 문자열
# - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (선택)

# DB 마이그레이션
npx prisma migrate dev

# 개발 서버 실행
npm run dev

# 브라우저에서 http://localhost:3000 접속
```

### 테스트 계정

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@shiftee.com | (seed에서 설정) |
| Manager | manager@shiftee.com | (seed에서 설정) |
| Employee | emp@shiftee.com | (seed에서 설정) |

---

## 📚 문서

- `APPROVAL_ORDER_FIX_SUMMARY.md` - 결재 순서 수정 상세 분석
- `TEST_APPROVAL_ORDER.md` - 결재 순서 테스트 가이드
- `C:\shiftee\packages\db\prisma\schema.prisma` - DB 스키마 정의

---

## 🔐 보안 주의사항

- 모든 API는 인증 필수 (`getSession()` 호출)
- 계약서는 권한별 필터링 (직원은 자신 계약만, 관리자는 전체)
- 삭제는 ADMIN만 가능
- SMTP 비밀번호는 .env.local에만 저장 (버전 관리 제외)

---

## 📞 연락처

- **개발팀:** -
- **버그 리포트:** GitHub Issues
- **문서:** 이 파일 참조

---

**마지막 수정:** Claude (2026-05-29)
**상태:** 진행 중
