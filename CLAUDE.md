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

# Project: 큐브티 (Cubetee) — 구 시프티(Shiftee)

HR 관리 시스템 + 사내 메신저 "큐브티워크".
Next.js 16 (App Router) + Prisma + PostgreSQL + Expo(SDK 54) React Native 모노레포.
**웹·앱 모두 완성되어 실서비스 운영 중** (cubetee.co.kr).

## 구조

```
apps/web       — Next.js 웹 (관리자/원장/직원 대시보드 + 큐브티워크 메신저)
apps/mobile    — Expo RN 앱 (App Store·Google Play 정식 출시 2026-08-19, 운영 중)
packages/api   — 웹·앱 공유 API 클라이언트 타입 (@shiftee/api, tsc dist 빌드 필요)
packages/db    — (레거시) 실제 활성 스키마는 apps/web/prisma/schema.prisma
```

## 배포 (운영)

- ⚠️ **배포 전 필수 — 정합 점검**: `bash deploy/preflight.sh` (불일치 시 중단하려면 `--strict`)
  여러 세션이 같은 프로젝트를 건드려서 **운영에만 있고 git 에는 없는 변경**이 실제로 생긴다
  (원장 겸직 지점·연차 연도전환·봇 결재 DM·서브관리자 수정 등이 그랬다).
  이 상태에서 로컬 파일을 통째로 덮어쓰면 **운영에서 이미 쓰는 기능이 조용히 사라진다.**
  불일치가 나오면 방향(운영이 최신인가, 로컬이 최신인가)을 먼저 확인하고 정리한 뒤 배포할 것.
  줄바꿈(CRLF) 차이는 스크립트가 정규화해서 무시한다.
- **웹**: Vultr VPS(64.176.228.203) Docker. 소스 `/opt/qubetee` (서버에 git 없음 → 변경 파일만 scp)
  ```bash
  ssh -i ~/.ssh/qubetee_deploy root@64.176.228.203
  scp -i ~/.ssh/qubetee_deploy <file> root@64.176.228.203:/opt/qubetee/apps/web/<path>
  cd /opt/qubetee && docker compose build --no-cache web && docker compose up -d --force-recreate web
  ```
  빌드가 SSH 세션보다 오래 걸리므로 `nohup sh -c "... && echo BUILD_OK >> /tmp/b.log" &` 후 폴링.
  **배포 직후 캐시 정리 필수**: `docker builder prune -af` — `--no-cache` 빌드 1회당 약 4GB 쌓인다.
  하루 8회 배포로 37.9GB까지 차서 디스크 80% 경고가 떴다(2026-08-18). 정리 cron 은 새벽 4시 1회뿐이라
  그 사이 배포가 몰리면 하루 만에 찬다.
- **DB(운영)**: 컨테이너 `qubetee-db-1`, user `postgres`, db `qubetee`
  ```bash
  docker exec -i qubetee-db-1 psql -U postgres -d qubetee
  ```
  **운영 DB에 `prisma db push` 금지**(드리프트) → `ALTER TABLE ... IF NOT EXISTS` 수동 DDL.
  스키마 변경 시: 로컬 schema.prisma 수정 → 서버 수동 DDL → 파일 scp → 리빌드.
- **앱**: EAS. JS 변경은 OTA로 즉시 배포(네이티브 모듈 추가 시에만 재빌드)
  ```powershell
  cd C:\shiftee\apps\mobile
  npx eas-cli update --branch production --message "..." --non-interactive
  npx eas-cli update --branch preview --message "..." --non-interactive   # 두 채널 모두 발행
  ```
  런타임 버전 1.3.0 (2026-08-03 expo-media-library 추가 재빌드 — 이후 OTA는 1.3.0 전용). **EAS 함정**: ①pnpm strict라서 package.json에 없는 전이 의존성 import는
  로컬(npm 호이스팅)에선 되는데 EAS 빌드에서 실패 → 재빌드 전 import 전수 스캔
  ②`eas build`는 반드시 **실경로**(Documents\시프티\apps\mobile)에서 실행 — junction에서 하면 즉사
  ③Sentry 소스맵 업로드는 eas.json `SENTRY_DISABLE_AUTO_UPLOAD=true`로 꺼져 있음(토큰 없이 빌드 가능).
- **관리자 계정(운영)**: `admin@cubetee.co.kr`
- **호스트 crontab**: `0 19 * * *`(KST 04:00) docker prune — 빌드 캐시 디스크 관리

## 로컬 개발

- 한글 경로 우회 junction → `C:\shiftee` (원본 `C:\Users\N-88\Documents\시프티`). **항상 junction 경유**
- 로컬 DB: `postgresql://postgres:password@localhost:5432/shiftee`
- 타입체크: `cd C:\shiftee\apps\web && npx.cmd tsc --noEmit`
  **알려진 기존(pre-existing) 오류** — 무시: employees/[id]/{delete,restore}, prisma/seed.ts,
  contracts 페이지, work/search, RoleSwitch, manager/team-contracts
- `packages/api` 타입 변경 시 `npx.cmd tsc`로 dist 재빌드 필요
- 모바일은 npm 아일랜드: `npm.cmd install --legacy-peer-deps` → 루트에서 `npx.cmd pnpm@10 install --lockfile-only`

## 주요 주의사항

- Next.js 16 — 동적 라우트 params는 `Promise<{ id: string }>`, `await params`
- **서버 TZ는 UTC** — 모든 날짜/시간 로직은 KST 보정 필수:
  `new Date(Date.now() + 9*3600*1000)` + `getUTC*()`. 헬퍼: `lib/kst.ts`, `lib/holidays.ts`
- `@db.Date` 컬럼은 UTC 자정 저장 — 날짜 비교는 "YYYY-MM-DD" 문자열로 정규화
- `User.branch String?` — Branch.name과 **문자열 매핑(FK 아님)**. 지점명 변경 시
  `PATCH /api/branches/[id]`가 트랜잭션으로 User.branch 동기화 (직접 UPDATE 금지)
- **원장(MANAGER) 지점 필터는 반드시 `getManagerBranches(userId)`** (`lib/manager-branches.ts`) —
  대표 지점 + 겸직 지점(ManagerBranch)을 합쳐서 봐야 함. `session.branch` 단독 사용 금지
  (토큰에 박제된 값이라 지점명 변경·겸직 반영이 안 됨)
- 연차는 `LeaveBalance` **(userId, year) 복합 유니크** — 조회 시 `currentLeaveYear()` 사용
- 봇 스케줄러: `src/instrumentation.ts` register() → 60초 틱 (globalThis 싱글턴)
- 오류 로그: `onRequestError` → SystemErrorLog. 알려진 무해 패턴은 `lib/monitor.ts`의
  `KNOWN_TRANSIENT_PATTERNS`에서 자동 처리완료 처리

---

# 구현 상태 (2026-07 기준, 전부 라이브)

## 핵심 도메인
- **인증**: JWT(jose) 세션. 웹=httpOnly 쿠키 / 앱=Bearer. 슬라이딩 세션(`/api/auth/refresh`,
  앱이 실행·포그라운드마다 갱신). 기기 잠금(UserDevice 1인1기기, 앱 로그인 시 자동 바인딩)
- **직원 관리**: CRUD, 엑셀 일괄 업로드/수정(이메일 매칭, 적힌 컬럼만 갱신), 선택 삭제,
  사원번호(5자리 표시, 수동 지정 가능), 퇴사/복구, 비밀번호 초기화(1234) + 24h 미변경 시 봇 알림
- **지점**: 실지점 16개, GPS 지오펜스(반경), `countInStats`(통계 제외 토글 — 테스트지점·본부)
- **출퇴근**: GPS 지오펜스(원장은 담당 지점 어디서든), 평일 10.5h/주말 승인시간+45분 퇴근 상한,
  관리자 수동 수정·생성, 통계, 엑셀 다운로드
- **휴가**: 역할·지점 기반 자동 결재 정책, 공휴일 제외 일수 계산, 연차 연도 전환(소멸+재부여)
- **근무일정**: 신청·결재, 주말 근무 사전승인
- **공휴일**: Holiday 테이블(2026~2027 시드 + 관리자 편집) — 휴가 일수·지각/조퇴 판정의 단일 소스
- **전자계약**: 워드(.docx) 템플릿 치환, 발송·서명·결재 (※ 운영 템플릿 미등록 상태)
- **큐브티워크(메신저)**: 채널/DM, 답장·수정·삭제·리액션, 파일·영상·앨범(500MB, 서버 자동 압축),
  공지·투표·링크모음, 전달·북마크·멘션모아보기, 예약전송·리마인더, 화상회의, 푸시 알림
- **큐브티 봇**: 아침 브리핑(지점별/반복주기/첨부·월별 카드뉴스), 결재 결과 DM(개인 수신설정+
  관리자 강제발송), 중요공지 재알림, 비번 변경 요청
- **운영**: 시스템 로그(처리완료 표시), 매시 헬스체크→관리자 봇 DM, 저장공간 관리, 감사 로그

## 남은 작업
- **전자계약 운영 템플릿** — 사용자가 실제 근로계약서 .docx 업로드 후 치환 필드 추가 예정
  (현재 필드: {직원명}{이름}{이메일}{연락처}{지점}{직책}{직급}{입사일}{제목}{계약시작일}
  {계약종료일}{연봉}{작성일})
- ~~v1.2.0 재빌드 배치~~ **완료(2026-07-15)**: 음성 메시지 + Sentry 크래시 추적 출시.
  안드 영상 기기 압축은 서버 압축으로 충분해 제외 결정
- **연 1회 운영 루틴**: 1월 초 연차 "연도 전환" 버튼 / 2027년 말 2028년 공휴일 등록
