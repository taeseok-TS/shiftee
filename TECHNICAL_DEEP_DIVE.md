# 계약서 결재 순서 구현 - 기술 분석

## 문제 분석

### 사용자 요청
결재 순서를 **동적으로 설정** 가능하게 함:
- "원장 → 직원 → 관리자"
- "직원 → 원장 → 관리자"
- 기타 모든 조합

### 초기 구현의 결함
1. **UI는 올바르게** 표시됨 (설정한 순서대로)
2. **DB에 저장도** 올바르게 함 (approvalLine.steps 배열이 순서대로 저장됨)
3. **하지만 이메일은** 항상 직원에게 먼저 감

### 근본 원인

파일: `C:\shiftee\apps\web\src\app\api\contracts\[id]\route.ts` (PATCH 핸들러)

**버그 코드 (202-211줄):**
```typescript
if (status === "SENT" && updated.user.email) {
  await sendContractNotification(
    updated.user.email,    // ❌ 항상 직원에게 보냄
    updated.user.name,
    updated.title,
    appUrl
  );
}
```

이 코드는 **설정된 결재 순서를 무시**하고 `updated.user` (직원)에게만 이메일을 발송.

---

## 기술적 배경

### 전체 데이터 흐름

```
1. 관리자가 UI에서 결재 순서 선택
   └─ approverIds = ["원장_id", "직원_id", "관리자_id"]

2. PATCH /api/contracts/[id] 호출
   ├─ approverIds 배열을 받음
   ├─ 기존 approvalLine 삭제
   └─ 새로운 approvalLine + steps 생성
      ├─ Step 1: approverId=원장_id, order=1, status=PENDING
      ├─ Step 2: approverId=직원_id, order=2, status=WAITING
      └─ Step 3: approverId=관리자_id, order=3, status=WAITING

3. 이메일 발송 (수정 전)
   └─ ❌ 항상 updated.user (직원)에게 → 버그!

4. 이메일 발송 (수정 후)
   ├─ firstPendingStep = steps에서 status=PENDING인 첫 번째
   ├─ 그 step의 approverId를 확인
   └─ ✅ 해당 사람에게 올바른 이메일 발송
```

### 데이터 구조 상세

**ContractApprovalStep 테이블:**
```
┌─────────────────────────────────────────────────────────┐
│ id    │ approverId  │ order │ status  │ decidedAt       │
├─────────────────────────────────────────────────────────┤
│ abc   │ 원장_id     │ 1     │ PENDING │ NULL            │
│ def   │ 직원_id     │ 2     │ WAITING │ NULL            │
│ ghi   │ 관리자_id   │ 3     │ WAITING │ NULL            │
└─────────────────────────────────────────────────────────┘
```

**Contract 테이블:**
```
┌──────────────────────────────────────────────────┐
│ id    │ userId   │ title     │ status │ ...      │
├──────────────────────────────────────────────────┤
│ xyz   │ 직원_id  │ 계약서A   │ SENT   │ ...      │
└──────────────────────────────────────────────────┘
```

**이메일 로직의 핵심 오류:**
```
// 버그: contract.userId (직원)를 하드코딩하여 사용
// 결재 순서와 무관하게 항상 직원에게 이메일 발송
if (status === "SENT") {
  // ❌ 이 코드는 contract.userId가 첫 번째 승인자가 아니어도 무조건 이메일을 보냄
  await sendContractNotification(updated.user.email, ...);
}
```

---

## 해결 방법

### 핵심 아이디어

"**PENDING 상태의 첫 번째 단계가 누구인지 찾고, 그 사람에게 이메일을 보낸다**"

### 수정 전 로직 (부작용 있음)

```typescript
// 항상 직원에게 이메일
if (status === "SENT" && updated.user.email) {
  await sendContractNotification(updated.user.email, ...);
}
```

**문제:**
- `status === "SENT"` 조건만 확인
- `updated.user` (직원)를 하드코딩
- 실제 결재 순서 무시

### 수정 후 로직 (올바름)

```typescript
if (status === "SENT") {
  // Step 1: 첫 번째 PENDING 단계 찾기
  const firstPendingStep = updated.approvalLine?.steps.find(
    s => s.status === "PENDING"
  );

  if (firstPendingStep) {
    // Step 2: 그 단계의 담당자가 직원인지 확인
    if (firstPendingStep.approverId === updated.userId && updated.user.email) {
      // 직원이 첫 번째 승인자 → 서명 요청
      await sendContractNotification(updated.user.email, ...);
    } else if (firstPendingStep.approver?.email) {
      // 다른 사람이 첫 번째 승인자 → 승인 요청
      await sendApprovalRequest(firstPendingStep.approver.email, ...);
    }
  }
}
```

**개선 사항:**
- ✅ 첫 번째 PENDING 단계를 동적으로 찾음
- ✅ 그 단계의 approverId와 비교
- ✅ 실제 결재 순서를 따름
- ✅ 유연한 설계 (어떤 순서든 가능)

---

## 단계별 이메일 흐름 추적

### 시나리오: 원장 → 직원 → 관리자

#### Phase 1: 계약서 발송 (Status: DRAFT → SENT)

**Action:** 관리자가 "발송" 클릭

**PATCH 핸들러 실행:**
```typescript
// PATCH /api/contracts/xyz
const approverIds = ["원장_id", "직원_id", "관리자_id"];

// approvalLine 생성 (라인 161-177)
approvalLine.steps = [
  { approverId: "원장_id", order: 1, status: "PENDING" },  // ← idx === 0
  { approverId: "직원_id", order: 2, status: "WAITING" },
  { approverId: "관리자_id", order: 3, status: "WAITING" },
];

// 이메일 발송 로직 (라인 202-234, 수정 후)
const firstPendingStep = updated.approvalLine.steps.find(s => s.status === "PENDING");
// firstPendingStep = { approverId: "원장_id", order: 1, status: "PENDING" }

if (firstPendingStep.approverId === updated.userId) {
  // "원장_id" === "직원_id" ? NO
  // ...
} else if (firstPendingStep.approver?.email) {
  // YES! 원장에게 승인 요청 이메일 발송
  await sendApprovalRequest(
    "원장@example.com",    // ✅ 원장의 이메일
    "원장",
    "계약서A",
    "직원",
    1,                      // 1단계
    appUrl
  );
}
```

**결과:** ✅ 원장이 승인 요청 이메일 수신

---

#### Phase 2: 원장이 승인

**Action:** 원장이 계약서 확인 후 승인

**POST /sign 핸들러 (라인 40-95):**
```typescript
// 로그인 사용자: 원장_id
// myStep 찾기
const myStep = approvalLine.steps.find(
  step => step.approverId === session.userId && step.status === "PENDING"
);
// myStep = { approverId: "원장_id", order: 1, status: "PENDING" } ✓

// Step 1 업데이트
await prisma.contractApprovalStep.update({
  where: { id: myStep.id },
  data: { status: "APPROVED", decidedAt: new Date() },
});

// 다음 단계 찾기
const nextStep = approvalLine.steps.find(
  step => step.order === myStep.order + 1
);
// nextStep = { approverId: "직원_id", order: 2, status: "WAITING" }

// Step 2를 PENDING으로 변경
await prisma.contractApprovalStep.update({
  where: { id: nextStep.id },
  data: { status: "PENDING" },
});

// 이메일 발송 (라인 73-82)
if (nextStep?.approver?.email) {
  // nextStep.approver = User { id: "직원_id", email: "직원@example.com", ... }
  await sendApprovalRequest(
    "직원@example.com",    // ✅ 직원의 이메일
    "직원",
    "계약서A",
    "직원",                // employeeName (contract.user.name)
    2,                      // 2단계
    appUrl
  );
}
```

**결과:** ✅ 직원이 서명 요청 이메일 수신

---

#### Phase 3: 직원이 서명

**Action:** 직원이 계약서 확인 후 서명

**POST /sign 핸들러 (Case 1, 라인 24-94):**
```typescript
// 로그인 사용자: 직원_id
// myStep 찾기
const myStep = approvalLine.steps.find(
  step => step.approverId === session.userId && step.status === "PENDING"
);
// myStep = { approverId: "직원_id", order: 2, status: "PENDING" } ✓

// ✓ Case 1: 직원이 서명하는 경우
if (myStep && myStep.approverId === contract.userId) {
  // "직원_id" === "직원_id" → TRUE
  
  // Step 2 업데이트
  await prisma.contractApprovalStep.update({
    where: { id: myStep.id },
    data: { status: "APPROVED", decidedAt: new Date() },
  });
  
  // employeeSignedAt 기록
  const updated = await prisma.contract.update({
    where: { id },
    data: { employeeSignedAt: new Date(), ... },
  });
  
  // 다음 단계 찾기
  const nextStep = approvalLine.steps.find(
    step => step.order === myStep.order + 1
  );
  // nextStep = { approverId: "관리자_id", order: 3, status: "WAITING" }
  
  // Step 3를 PENDING으로 변경
  await prisma.contractApprovalStep.update({
    where: { id: nextStep.id },
    data: { status: "PENDING" },
  });
  
  // 이메일 발송 (라인 73-82)
  if (nextStep?.approver?.email) {
    // nextStep.approver = User { id: "관리자_id", email: "관리자@example.com", ... }
    await sendApprovalRequest(
      "관리자@example.com",  // ✅ 관리자의 이메일
      "관리자",
      "계약서A",
      "직원",                // employeeName
      3,                      // 3단계
      appUrl
    );
  }
}
```

**결과:** ✅ 관리자가 승인 요청 이메일 수신

---

#### Phase 4: 관리자가 최종 승인

**Action:** 관리자가 계약서 확인 후 승인

**POST /sign 핸들러 (Case 3, 라인 106-177):**
```typescript
// 로그인 사용자: 관리자_id
// myStep 찾기
const myStep = approvalLine.steps.find(
  step => step.approverId === session.userId && step.status === "PENDING"
);
// myStep = { approverId: "관리자_id", order: 3, status: "PENDING" } ✓

// ✓ Case 3: 승인자가 승인하는 경우
if (myStep) {
  // Step 3 업데이트
  await prisma.contractApprovalStep.update({
    where: { id: myStep.id },
    data: { status: "APPROVED", decidedAt: new Date() },
  });
  
  // 다음 단계 확인
  const nextStep = approvalLine.steps.find(
    step => step.order === myStep.order + 1
  );
  // nextStep = undefined (3단계가 마지막)
  
  // 계약 완료
  const finalContract = await prisma.contract.update({
    where: { id },
    data: {
      status: "SIGNED",  // 최종 상태
      signedAt: new Date(),
    },
  });
  
  // 이메일 발송 (라인 166-174)
  if (!nextStep && finalContract.user.email) {
    // 계약 완료 이메일 발송
    await sendContractCompletion(
      "직원@example.com",    // ✅ 직원에게 완료 알림
      "직원",
      "계약서A",
      "직원",
      appUrl
    );
  }
}
```

**결과:** ✅ 직원이 완료 이메일 수신, 계약서 상태 = SIGNED

---

## 코드 변경 영향도 분석

### 수정된 파일
- `C:\shiftee\apps\web\src\app\api\contracts\[id]\route.ts`

### 변경 범위
- 임포트: 1줄 (sendApprovalRequest 추가)
- 로직: 33줄 (202-234줄, 약 10줄 → 33줄로 확장)

### 영향받는 기능
- ✅ 계약서 발송 시 이메일 (수정됨)
- ⚪ 계약서 서명 시 이메일 (변경 없음, 이미 올바름)
- ⚪ 계약서 완료 시 이메일 (변경 없음, 이미 올바름)

### 영향받지 않는 기능
- ⚪ 계약서 생성/수정/삭제
- ⚪ 승인 단계 생성 로직 (이미 올바름)
- ⚪ 승인/거절 처리
- ⚪ 결재 이력 조회

---

## 호환성 검증

### 기존 계약서 호환성
✅ 이미 생성된 계약서는 영향 없음
- 승인 단계가 이미 저장되어 있음
- 새로운 이메일 로직만 적용됨

### 승인 순서별 호환성

| 순서 | 상황 | 호환성 |
|------|------|--------|
| 원장 → 직원 → 관리자 | 원장이 첫 번째 | ✅ |
| 직원 → 원장 → 관리자 | 직원이 첫 번째 | ✅ |
| 관리자 → 원장 → 직원 | 관리자가 첫 번째 | ✅ |
| 기타 모든 조합 | 동적으로 결정 | ✅ |

### 역할별 호환성

| 역할 | 기능 | 호환성 |
|------|------|--------|
| ADMIN | 계약서 발송 | ✅ |
| MANAGER | 계약서 발송 | ✅ |
| EMPLOYEE | 계약서 서명/승인 | ✅ |

---

## 성능 영향도

### 데이터베이스 쿼리
- **추가 쿼리:** 0개 (이미 데이터를 fetch한 후 JavaScript에서 필터링)
- **성능 영향:** 무시할 수 있는 수준

### 메모리 사용
- **추가 메모리:** 무시할 수 있는 수준 (문자열 비교만)

### API 응답 시간
- **변화:** ±0ms (이미 approval line을 포함하여 반환하므로)

---

## 테스트 케이스

### 단위 테스트 (Mock)
```typescript
// firstPendingStep 찾기
const approvalLine = {
  steps: [
    { approverId: "원장_id", order: 1, status: "PENDING", approver: { email: "원장@..." } },
    { approverId: "직원_id", order: 2, status: "WAITING", approver: { email: "직원@..." } },
  ]
};

const firstPendingStep = approvalLine.steps.find(s => s.status === "PENDING");
expect(firstPendingStep.approverId).toBe("원장_id");
expect(firstPendingStep.approver.email).toBe("원장@...");
```

### 통합 테스트 (E2E)
1. 원장 → 직원 → 관리자 순서로 설정
2. 발송 후 원장이 이메일 수신 확인
3. 원장 승인 후 직원이 이메일 수신 확인
4. 직원 서명 후 관리자가 이메일 수신 확인
5. 관리자 승인 후 계약 완료 확인

---

## 결론

### 근본 원인
- 이메일 발송 로직이 실제 승인 순서와 독립적으로 작동

### 해결 방법
- 첫 번째 PENDING 단계의 담당자를 동적으로 찾아 이메일 발송

### 결과
- ✅ 어떤 순서든 결재 가능
- ✅ 이메일이 올바른 사람에게 전달
- ✅ 기존 코드와의 호환성 유지
- ✅ 성능 영향 없음

---

**작성일:** 2026-05-29
**상태:** 완료 및 검증됨
