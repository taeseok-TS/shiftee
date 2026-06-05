# 결재 순서 유연성 테스트 가이드

## 테스트 환경 확인

```bash
# 개발 서버 실행
cd C:\shiftee
npm run dev

# 또는
pnpm dev
```

## 테스트 시나리오

### 🧪 테스트 1: 원장 → 직원 → 관리자 순서

**준비:**
1. 관리자 계정으로 로그인
2. 계약서 목록 → 새 계약서 작성
3. 직원 선택: "홍길동" (당사자)
4. 계약서 정보 입력 (제목, 파일 등)
5. "승인자 설정" 클릭

**결재 순서 설정:**
- 1단계: 김태석 (원장)
- 2단계: 홍길동 (직원/당사자)
- 3단계: 박관리 (관리자)

**발송:**
- "발송" 버튼 클릭

**예상 결과:**
```
✅ 김태석(원장)이 승인 요청 이메일 수신
   - 제목: "[승인 요청] 계약서명 - 1단계 승인 필요"
   - 내용: "홍길동이(가) 서명한 계약서의 승인이 필요합니다"
```

**검증 방법:**
- 이메일 로그 확인: `console.log` 출력 확인
- Network 탭에서 PATCH 요청 응답 확인
- 결재 진행 상태에서 "1단계 김태석"이 표시됨

---

### 🧪 테스트 2: 직원 → 원장 → 관리자 순서

**준비:** 새 계약서 작성 (위와 동일)

**결재 순서 설정:**
- 1단계: 홍길동 (직원/당사자)
- 2단계: 김태석 (원장)
- 3단계: 박관리 (관리자)

**발송:**
- "발송" 버튼 클릭

**예상 결과:**
```
✅ 홍길동(직원)이 서명 요청 이메일 수신
   - 제목: "[홍길동] 계약서 서명 요청"
   - 내용: "계약서가 서명을 위해 발송되었습니다"
```

**검증 방법:**
- console.log에서 다음 확인:
  ```
  📧 첫 번째 PENDING 단계가 직원입니다. 직원에게 서명 요청 이메일 발송: hong@example.com
  ```

---

### 🧪 테스트 3: 결재 흐름 전체 검증 (원장 → 직원 → 관리자)

**Step 1: 발송 (위의 테스트 1과 동일)**

**Step 2: 원장(김태석)이 승인**
```
예상 결과:
✅ 직원(홍길동)이 서명 요청 이메일 수신
   - 이전 이메일과 동일한 "서명 요청" 이메일
```

**Step 3: 직원(홍길동)이 서명**
```
예상 결과:
✅ 관리자(박관리)가 승인 요청 이메일 수신
   - 제목: "[승인 요청] 계약서명 - 3단계 승인 필요"
```

**Step 4: 관리자(박관리)가 최종 승인**
```
예상 결과:
✅ 직원(홍길동)이 완료 이메일 수신
   - 제목: "[계약 완료] 계약서명"
   - 내용: "계약이 완료되었습니다"
   - 계약 상태 = SIGNED
```

---

## 📊 로그 확인 위치

### 브라우저 콘솔 (개발자 도구 - F12)
```
Network 탭:
1. PATCH /api/contracts/{id} 클릭
2. Response 확인
3. approvalLine.steps 배열의 첫 번째 step이 status="PENDING"인지 확인
4. 그 step의 approverId가 올바른지 확인
```

### 서버 로그 (터미널)
```
=== PATCH 요청 처리 ===
status: SENT
approverIds: ["kim-id", "hong-id", "park-id"]
contractId: 123

단계 1: approverId=kim-id, status=PENDING
단계 2: approverId=hong-id, status=WAITING
단계 3: approverId=park-id, status=WAITING

📧 첫 번째 PENDING 단계가 승인자입니다. 승인자에게 승인 요청 이메일 발송: kim@example.com
```

---

## 🐛 문제 진단

### 증상 1: 여전히 직원이 이메일을 먼저 받음
**확인 사항:**
```
서버 로그에서 다음 중 어느 것이 출력되는지 확인:

❌ 직원이 먼저 이메일을 받는 경우:
📧 첫 번째 PENDING 단계가 직원입니다. 직원에게 서명 요청 이메일 발송

✅ 원장이 먼저 이메일을 받는 경우:
📧 첫 번째 PENDING 단계가 승인자입니다. 승인자에게 승인 요청 이메일 발송
```

### 증상 2: 이메일이 발송되지 않음
**확인 사항:**
```
⚠️ SMTP credentials not configured. Email not sent.
→ .env.local에 SMTP 설정 확인

❌ Failed to send email to ...
→ SMTP 서버 연결 확인
→ 방화벽/네트워크 설정 확인
```

### 증상 3: 결재 순서가 UI에 반영되지 않음
**확인 사항:**
```
Network 탭에서 GET /api/contracts/{id} 응답 확인
approvalLine.steps 배열이 설정한 순서대로 정렬되어 있는지 확인

예상:
[
  { approverId: "kim-id", order: 1, status: "PENDING" },
  { approverId: "hong-id", order: 2, status: "WAITING" },
  { approverId: "park-id", order: 3, status: "WAITING" }
]
```

---

## 📋 체크리스트

테스트 완료 후 확인:

- [ ] 원장 → 직원 → 관리자 순서 이메일 정상 발송
- [ ] 직원 → 원장 → 관리자 순서 이메일 정상 발송
- [ ] 결재 진행 상태 UI에서 순서 올바르게 표시
- [ ] 각 단계 완료 후 다음 승인자에게 이메일 전달
- [ ] 최종 승인 후 직원에게 완료 이메일 발송
- [ ] 계약 상태가 SIGNED로 변경됨

---

## 🔧 로컬 테스트 (SMTP 없이)

SMTP를 설정하지 않은 경우, 서버 로그에서 다음을 확인하면 됨:

```
⚠️ SMTP credentials not configured. Email not sent.
To: kim@example.com, Subject: [승인 요청] 계약서명 - 1단계 승인 필요
```

이 메시지가 나오면 이메일 로직은 정상 작동하고 있으며, SMTP만 설정하면 실제 이메일이 발송됨.

---

## 📝 참고

- 변경 파일: `C:\shiftee\apps\web\src\app\api\contracts\[id]\route.ts`
- 변경 내용: sendContractNotification + sendApprovalRequest 임포트 추가, 이메일 로직 수정
- 이전 동작: 항상 직원에게 이메일 발송
- 수정 후 동작: 첫 번째 PENDING 단계의 담당자에게 이메일 발송
