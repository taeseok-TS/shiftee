# 워게임 (War Games) — 시프티 잔여 작업 실행 청사진

이 폴더는 **계획(plan)이 아니라 워게임(war game)** 모음입니다.

일반적인 계획은 "이 순서로 만들면 된다"는 청사진(blue-sky scenario)만 담습니다.
워게임은 그 위에 **모든 수(move)마다 실패 시나리오, 원인 신호, 대응 수(counter-move),
분기 트리거, 중단 조건**까지 미리 시뮬레이션해 둔 문서입니다.

목표: 이 문서를 **어떤 실행자 모델**(Opus, Sonnet, GPT, 오픈소스 모델 등)에게 넘겨도,
실제 코드베이스에서 마주칠 현실을 미리 알고 자신 있게 실행할 수 있게 하는 것.

## 구조

```
wargames/
├── README.md      ← 이 문서
├── success.md     ← 모든 미션 공통 성공 기준
├── ledger.md      ← 차단 요소 / 사용자 입력이 필요한 변수 목록
├── tasks/         ← 미션 브리프 (무엇을 원하는가)
│   ├── 01-branch-rename-sync.md
│   ├── 02-leave-year-rollover.md
│   ├── 03-korean-holidays.md
│   └── 04-attendance-manual-edit.md
└── plans/         ← 워게임 결과물 (실행자에게 투입하는 문서)
    ├── 01-branch-rename-sync.md
    ├── 02-leave-year-rollover.md
    ├── 03-korean-holidays.md
    └── 04-attendance-manual-edit.md
```

## 사용법

1. `ledger.md`에서 해당 미션의 미해결 변수를 채운다 (예: 실제 지점명 목록, 공휴일 API 키).
2. 실행자 모델에게 다음을 함께 투입한다:
   - `plans/NN-*.md` (워게임 본문)
   - `success.md` (성공 기준)
   - `CLAUDE.md` (프로젝트 규칙 — 단, "현재 구현 상태" 섹션은 오래됐으니 워게임의 정찰 결과를 우선)
3. 실행자에게 지시: *"이 워게임의 수순대로 실행하되, 각 수의 '예상 관찰'과 실제 관찰이
   다르면 해당 분기 트리거를 따르고, 중단 조건에 걸리면 즉시 멈추고 보고하라."*

## 미션 선정 근거 (2026-07 정찰 기준)

CLAUDE.md의 "미구현" 목록 중 상당수는 이미 구현되어 있음을 확인했다:
전자계약(발송/서명/버전/회수), 대시보드(admin/manager/me), 퇴직 처리(resign/restore/archived),
연차 잔여 수동 조정(`PATCH /api/leave/balance` + 감사로그), 모바일 앱(주요 화면 존재),
알림(이메일 nodemailer + 푸시 PushToken).

실제로 남아 있는 것만 워게임 대상으로 삼았다:

| # | 미션 | 왜 위험한가 |
|---|------|------------|
| 01 | 지점명 실제화 + 이름 변경 동기화 | `Branch.name` 문자열이 User.branch, JWT 세션, 27개 API 필터, 지오펜스에 결합 |
| 02 | 연차 연도 전환 (이월/재생성) | `LeaveBalance.userId`가 `@unique` — 유저당 1행 구조라 연도별 이력이 불가능한 스키마 |
| 03 | 한국 공휴일 연동 | 휴가 일수 계산이 주말만 제외 (`api/leave/route.ts:93`), 지각 판정이 공휴일 무시 |
| 04 | 출퇴근 수동 수정 | 현재 9시간 휴리스틱 자동보정만 존재, 상태 재계산 로직이 인라인 중복 위험 |
