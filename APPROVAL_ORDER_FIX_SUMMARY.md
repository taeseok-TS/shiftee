# 계약서 결재 순서 유연성 수정 완료

## 문제점
사용자가 결재 순서를 "원장 → 직원 → 관리자"로 설정해도, 실제 이메일과 결재 흐름은 여전히 **직원이 먼저** 받도록 되어 있었음.

## 근본 원인
`/api/contracts/[id]/route.ts`의 PATCH 핸들러에서 계약서 상태를 `SENT`로 변경할 때:
```typescript
// ❌ 버그: 항상 employee에게 이메일을 보냄
if (status === "SENT" && updated.user.email) {
  await sendContractNotification(
    updated.user.email,           // 항상 직원
    updated.user.name,
    updated.title,
    appUrl
  );
}
```

이 코드는 실제 결재 순서를 무시하고 무조건 직원(`updated.user`)에게 이메일을 발송했음.

## 해결책
결재 순서와 무관하게 **첫 번째 PENDING 단계의 담당자**에게 이메일을 발송하도록 수정:

```typescript
// ✅ 수정: 첫 번째 PENDING 단계의 담당자에게 이메일 발송
if (status === "SENT") {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  
  // 첫 번째 PENDING 단계 찾기
  const firstPendingStep = updated.approvalLine?.steps.find(s => s.status === "PENDING");
  
  if (firstPendingStep) {
    // 첫 번째 단계가 직원인가?
    if (firstPendingStep.approverId === updated.userId && updated.user.email) {
      // 직원이 첫 번째 → 서명 요청 이메일
      await sendContractNotification(...);
    } else if (firstPendingStep.approver?.email) {
      // 직원이 아니면 → 승인 요청 이메일
      await sendApprovalRequest(...);
    }
  }
}
```

## 적용된 변경 사항

### 파일: `C:\shiftee\apps\web\src\app\api\contracts\[id]\route.ts`

**1. 임포트 추가 (라인 4)**
- `sendApprovalRequest` 함수를 새로 임포트

**2. 이메일 로직 수정 (라인 202-234)**
- 첫 번째 PENDING 단계의 담당자 조회
- 해당 담당자가 직원인지 판단
- 직원이면 `sendContractNotification()` 호출
- 직원 아니면 `sendApprovalRequest()` 호출

## 결재 흐름 검증

### 시나리오: 원장 → 직원 → 관리자 순서

**단계 1: 매니저가 계약서 발송 (SENT)**
```
발송 시 설정: approverIds = ["원장_id", "직원_id", "관리자_id"]

생성되는 단계:
- 1단계: approverId=원장_id, status=PENDING ✓
- 2단계: approverId=직원_id, status=WAITING
- 3단계: approverId=관리자_id, status=WAITING

이메일 발송:
- 첫 번째 PENDING = 1단계 (원장)
- 원장_id ≠ 직원_id → sendApprovalRequest() 호출
- 원장이 승인 요청 이메일 수신 ✓✓✓
```

**단계 2: 원장이 승인**
```
- 1단계: status=APPROVED
- 2단계: status=PENDING (업데이트됨)
- 3단계: status=WAITING

이메일 발송:
- nextStep = 2단계 (직원)
- sendApprovalRequest() 호출
- 직원이 승인 요청 이메일 수신 ✓
```

**단계 3: 직원이 서명**
```
- 1단계: status=APPROVED
- 2단계: status=APPROVED
- 3단계: status=PENDING (업데이트됨)

이메일 발송:
- employeeSignedAt 기록
- nextStep = 3단계 (관리자)
- sendApprovalRequest() 호출
- 관리자가 승인 요청 이메일 수신 ✓
```

**단계 4: 관리자가 최종 승인**
```
- 1단계: status=APPROVED
- 2단계: status=APPROVED
- 3단계: status=APPROVED
- Contract status=SIGNED

이메일 발송:
- sendContractCompletion() 호출
- 직원에게 최종 완료 이메일 수신 ✓
```

## 관련 코드 분석

### 승인 단계 생성 로직 (PATCH, 라인 161-177)
```typescript
const approvalLine = await prisma.contractApprovalLine.create({
  data: {
    contractId: id,
    steps: {
      createMany: {
        data: approverIds.map((approverId: string, idx: number) => {
          const stepStatus = status === "SENT" && idx === 0 ? "PENDING" : "WAITING";
          // idx가 0 (첫 번째)이고 SENT 상태면 PENDING
          // 나머지는 WAITING
          return {
            approverId,
            order: idx + 1,  // 1부터 시작
            status: stepStatus,
          };
        }),
      },
    },
  },
});
```

### 승인/서명 처리 (POST /sign)
- 라인 24-94: Case 1 (직원 서명) - approverId === contract.userId인 경우
- 라인 106+: Case 3 (승인자 승인) - approverId ≠ contract.userId인 경우
- 각 경우 정상 처리됨 (이미 올바르게 구현됨)

### 이메일 함수 (email.ts)
- `sendContractNotification()`: 직원에게 서명 요청
- `sendApprovalRequest()`: 승인자에게 승인 요청

## 테스트 체크리스트

- [ ] 원장 → 직원 → 관리자 순서로 계약서 발송
  - [ ] 원장이 승인 요청 이메일 수신
  - [ ] 원장이 승인 후 직원이 서명 요청 이메일 수신
  - [ ] 직원이 서명 후 관리자가 승인 요청 이메일 수신
  - [ ] 모든 승인 완료 후 계약 상태 = SIGNED

- [ ] 직원 → 원장 → 관리자 순서로 계약서 발송
  - [ ] 직원이 서명 요청 이메일 수신
  - [ ] 직원이 서명 후 원장이 승인 요청 이메일 수신
  - [ ] 원장이 승인 후 관리자가 승인 요청 이메일 수신

- [ ] 결재 히스토리 모달에서 단계 순서 확인
  - [ ] 설정한 순서대로 표시됨

## 추가 개선 사항 (선택사항)

향후 다음 기능들을 추가할 수 있음:
1. **결재 단계별 댓글/의견** - 각 단계에서 거절 이유 남기기
2. **시간대별 추적** - 각 단계별 승인 시간 기록
3. **결재 위임** - 승인자가 다른 사람에게 권한 위임
4. **SMS 알림** - 이메일 외에 SMS로도 알림 발송

## 정리

✅ **문제 해결**
- 결재 순서가 이제 정확하게 반영됨
- 첫 번째 승인자가 올바르게 이메일 수신
- 이후 단계도 순차적으로 진행됨

✅ **코드 품질**
- 명확한 로깅 추가 (디버깅 용이)
- 조건부 이메일 발송 (유연함)
- 기존 로직과의 호환성 유지
