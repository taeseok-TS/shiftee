# @shiftee/api

Shiftee HR 시스템의 공유 API 클라이언트 및 타입 정의

Web(`apps/web`)과 Mobile(`apps/mobile`) 애플리케이션이 **동일한 타입과 API 클라이언트**를 사용하도록 함.

## 📦 구조

```
src/
├── types/       # 공유 타입 정의 (Request/Response)
├── client/      # API 클라이언트 (AxiosInstance 기반)
└── index.ts     # 메인 export
```

## 🚀 사용법

### 설치

```bash
pnpm install
```

### Web에서 사용

```typescript
// apps/web/src/lib/api.ts
import { initializeApi, getApiClient } from "@shiftee/api";

// 초기화 (API 라우트에서)
export const apiClient = initializeApi(
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000/api",
  async () => {
    const session = await getSession();
    return session?.token || null;
  }
);

// 사용
export const getContracts = () => apiClient.getContracts();
```

### Mobile에서 사용

```typescript
// apps/mobile/src/services/api.ts
import { initializeApi } from "@shiftee/api";
import { getToken } from "./storage";

export async function initializeApiClient() {
  return initializeApi(
    process.env.API_BASE_URL || "http://localhost:3000/api",
    getToken,
    () => {
      // 401 시 로그인 화면으로
    }
  );
}
```

## 📋 API 메서드

### 인증
- `login(email, password)` - 로그인
- `logout()` - 로그아웃

### 계약서
- `getContracts()` - 계약서 목록
- `getContract(id)` - 상세 조회
- `createContract(data)` - 생성
- `updateContract(id, data)` - 수정
- `signContract(id, data)` - 서명

### 휴가
- `getLeaveRequests(year?, month?)` - 휴가 신청 목록
- `createLeaveRequest(data)` - 신청
- `approveLeave(id, data)` - 승인/반려
- `getMyLeaveApprovals()` - 내 승인 대기

### 출퇴근
- `clockIn(data)` - 출근
- `clockOut(data)` - 퇴근
- `getAttendance(date)` - 출퇴근 기록
- `getDaySchedule(date)` - 일일 일정

## 🔄 API 응답 일관성

모든 응답은 통일된 형식:

```typescript
interface ApiResponse<T> {
  success?: boolean;
  data?: T;
  error?: string;
  [key: string]: any;
}
```

## ⚠️ 에러 처리

```typescript
try {
  const contracts = await apiClient.getContracts();
} catch (error) {
  if (error instanceof ApiErrorClass) {
    console.error(`[${error.status}] ${error.message}`);
  }
}
```

## 🏗️ 타입 재사용

Web이나 Mobile에서 **새로운 API 타입이 필요하면**:

1. `packages/api/src/types/index.ts`에 추가
2. `packages/api/src/client/index.ts`에 메서드 추가
3. Web & Mobile이 **자동으로 사용** 가능

이렇게 하면 **API 응답 구조가 변경되어도 한 곳에서만 수정** ✨

## 📝 개발 흐름

```
1. 백엔드 API 구현 (apps/web/src/app/api/...)
   ↓
2. packages/api에 타입 & 클라이언트 메서드 추가
   ↓
3. Web & Mobile에서 사용 (자동 타입 체크)
   ↓
4. 변경사항 자동으로 양쪽 반영 ✅
```
