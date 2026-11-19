import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

export const dynamic = "force-dynamic";

// AI(Claude·ChatGPT 등)가 읽고 바로 쓰는 안내 — 인증 없음(비밀 없음). 마크다운 텍스트.
export async function GET() {
  const base = `${getAppUrl()}/api/v1`;
  const md = `# 큐브티 개인 API (v1)

큐브티워크의 **자료제출**과 **채팅**을 직원 본인의 API 키로 씁니다. 키로 한 일은 모두 그 직원 이름으로 기록되고,
키로 할 수 있는 일은 그 직원이 화면에서 할 수 있는 일을 넘지 못합니다.

- 기본 주소: \`${base}\`
- 인증: 모든 요청에 \`Authorization: Bearer cbt_pk_…\` 헤더
- 응답: JSON. 실패는 \`{ "error": "사람이 읽는 설명", "code": "NO_KEY|BAD_KEY|REVOKED|EXPIRED|SUSPENDED|NO_SCOPE|NOT_ALLOWED|RATE_*" }\`
- 한도: 키당 분당 60회·하루 2,000회, 쓰기 분당 10회, 제출(파일 올리기) 요청 하루 50회. 넘으면 429.
- 키는 프로필 › **AI 연결 키** 에서 만듭니다(본부가 허용한 계정만). 범위(scope)는 만들 때 고른 것만 됩니다.

> 단순한 "매일 몇 시에 이 방에 글 올리기"는 큐브티워크 안의 **예약 메시지** 기능이 더 간단합니다. API 는 AI 가 판단해 쓰는 경우에 쓰세요.

## 내 정보
\`GET /me\` → 키 주인·범위·만료.

## 자료제출 (scope: submissions:read / submissions:write)

### 분류 목록
\`GET /submissions/categories\` → \`{ categories: [{ id, group: "EDU|PROMO|EVENT", name }] }\`

### 내야 할 것 (본부가 나에게 건 요청)
\`GET /submissions/requests?status=open|closed|all\` (기본 open)
→ \`{ requests: [{ id, title, description, category: {id,name}, dueDate: "YYYY-MM-DD"|null, mySubmissionId: string|null }] }\`
\`mySubmissionId\` 가 null 이면 아직 안 낸 것입니다.

### 내 제출 / 공유 자료
\`GET /submissions?scope=mine|shared\` (기본 mine) → \`{ submissions: [{ id, title, category, request, yearMonth, files: [{url,name,size,type}], status, shared, createdAt }] }\`
파일 내려받기: \`GET ${getAppUrl()}<files[].url>\` 에 같은 Authorization 헤더(submissions:read). 워드·PPT·엑셀의 PDF 미리보기는 \`GET ${getAppUrl()}/api/docs/pdf?src=<files[].url>\`.

### 제출하기 (multipart/form-data)
\`POST /submissions\`
- \`files\`: 파일 1~10개 (워드·엑셀·PPT·PDF·한글·이미지·ZIP, 파일당 50MB)
- \`requestId\`: 요청에 대한 제출이면 그 id (분류는 요청 것을 따름). 자유 제출이면 생략하고 \`categoryId\` 지정
- \`title\`(선택, 없으면 첫 파일 이름), \`memo\`(선택), \`yearMonth\`(선택 "YYYY-MM", 기본 이번 달)
- 지점·직책·직급은 서버가 직원 정보로 채웁니다.
→ \`{ submission: {...} }\`. 같은 요청에 이미 냈으면 409.

예:
\`\`\`
curl -X POST ${base}/submissions \\
  -H "Authorization: Bearer cbt_pk_…" \\
  -F "requestId=<요청 id>" -F "title=HOW교육 과제_교실운영개선안" \\
  -F "files=@개선안.docx"
\`\`\`

## 채팅 (scope: chat:read / chat:write) — 본인이 속한 방만

### 내 방 목록
\`GET /chat/channels\` → \`{ channels: [{ id, name, type: "CHANNEL|DM", canWrite: boolean }] }\`
\`canWrite\` 는 키를 만들 때 "메시지 올릴 방"으로 고른 방만 true.

### 방의 메시지 읽기
\`GET /chat/channels/{id}/messages?after=<메시지 id>&limit=50\` → 시간순 \`{ messages: [{ id, userName, content, createdAt, fileUrl }], nextAfter }\`
\`after\` 를 마지막으로 본 메시지 id 로 주면 그 뒤 것만 옵니다(폴링용). 삭제된 메시지는 빠집니다.

### 방에 메시지 올리기
\`POST /chat/channels/{id}/messages\` JSON \`{ "content": "…" }\` (2,000자까지)
→ 올라간 메시지는 앞에 🤖 표시가 붙어 자동 전송임이 보입니다. 키 생성 때 고르지 않은 방은 403.

## 마케팅 자료 — 회사 연동 키 전용 (scope: marketing:read / marketing:publish)

본부가 \`/admin/integration-keys\`(설정 › 연동 키)에서 발급한 **회사 연동 키**로만 됩니다(개인 키 불가). 큐브마케팅이 지점이 올린 마케팅 자료를 가져가 블로그에 발행하고 결과를 되돌려주는 창구입니다.

### 가져가기
\`GET /marketing/materials?status=new|published|all&since=<ISO 시각>&limit=50&cursor=<id>\` (기본 status=new — 아직 발행되지 않은 것)
→ \`{ materials: [{ id, title, description, category: {id,name}, branch, uploader: {name, jobGroup, position}, yearMonth, consent: true, files: [{url(절대 주소), name, size, type}], publishedAt, publishedUrl, publishHistory: [{url, note, at, by}], createdAt }], nextCursor }\`
- \`publishHistory\` 는 발행 기록(오래된 것부터). \`publishedAt\`·\`publishedUrl\` 은 마지막 발행입니다.
- 개인정보 동의 체크가 된 자료만 나옵니다. 검수(얼굴·이름·성적 가림 확인)는 가져가는 쪽 책임입니다.
- 파일은 \`files[].url\` 에 같은 Authorization 헤더로 GET. 워드·PPT·엑셀 PDF 미리보기는 \`GET ${getAppUrl()}/api/docs/pdf?src=<url>\`.
- 오래된 순(createdAt 오름차순). \`nextCursor\` 가 있으면 \`cursor=\` 로 이어서 받습니다. 주기 폴링은 마지막으로 본 \`createdAt\` 을 \`since\` 로.

### 발행 결과 되돌려주기
\`POST /marketing/materials/{id}/published\` JSON \`{ "url": "https://blog…", "note": "선택, 300자" }\`
→ 발행 기록에 한 줄이 더해지고(발행 1회·2회…), 올린 직원에게 봇 DM "블로그에 발행되었습니다 + 주소 + note"가 갑니다.
- 같은 자료를 **다른 글 주소**로 다시 보내면 2번째·3번째 발행으로 쌓이고 DM 도 다시 갑니다("또 발행되었습니다(N번째 글)").
- **같은 주소**를 다시 보내면 그 줄의 note 만 고치고 DM 은 보내지 않습니다. 응답 \`{ id, publishedAt, publishedUrl, publishCount, isNew }\`.

## 직원에게 1:1 DM 보내기 — 회사 연동 키 전용 (scope: dm:send)

본부가 \`/admin/integration-keys\`(설정 › 연동 키)에서 발급한 **회사 연동 키**로만 됩니다. 직영 포털 같은 서버가 사번으로 직원에게 알림을 보내는 창구입니다.
보내는 사람은 **「에듀플렉스 알림」** 시스템 계정이고, 직원 앱에 푸시가 갑니다.

\`POST /dm\` JSON \`{ "empNo": "06582", "text": "○○ 학생 START SETTING 완료 — START CHECK 진행해 주세요", "refId": "start-setting-123" }\`
- 여러 명: \`"empNos": ["06582", "06583"]\` (한 번에 50명까지). 사번은 앞 0 이 있어도 없어도 됩니다.
- \`text\` 는 2,000자까지(줄바꿈 가능).
- \`refId\`(선택, 120자까지): 같은 키·같은 refId·같은 사번이면 **다시 보내지 않습니다**(\`duplicate\`). 실패했던 건은 같은 refId 로 다시 보내면 다시 시도합니다.
→ \`{ results: [{ empNo, status: "sent"|"duplicate"|"failed", reason?, name? }], sent, duplicate, failed }\`
- \`reason\`: \`NOT_FOUND\`(없는 사번) · \`RESIGNED\`(퇴사자) · \`INACTIVE\`(쓰지 않는 계정) · \`BAD_EMPNO\`(사번 형식) · \`SEND_ERROR\`(보내기 오류 — 다시 시도) · \`RATE_PERSON_DAY\`(한 사람 하루 30건 초과) · \`SAME_REF_ID\`/\`SAME_REQUEST\`(중복)
- 키당 하루 받는 사람 3,000명을 넘는 요청은 통째로 429 \`RATE_DM_DAY\` 입니다.
- **refId 를 꼭 넣어 주세요.** 받는 사람이 많으면 응답이 몇 초 걸릴 수 있는데, 기다리다 끊고 다시 보내도 refId 가 같으면 두 번 가지 않습니다.
- 한도: 키당 분당 쓰기 10회 · 하루 2,000회(요청 수 기준), 하루 받는 사람 3,000명, 한 사람에게 하루 30건(넘으면 \`RATE_PERSON_DAY\` 로 실패). IP 제한은 없습니다(키로만 확인).

## 휴가 신청 읽기 — 회사 연동 키 전용 (scope: leave:read)
\`GET /leave/requests?since=<ISO 시각>&jobGroup=원장&limit=200\`
- \`since\`: 이 시각 이후에 **신청된** 건(신청 시각 기준, 없으면 24시간 전부터). 상태가 바뀐 건(승인 · 반려 · 취소)을 보려면 \`updatedSince=<ISO>\` 를 대신 줍니다.
- \`jobGroup\`: 직무(원장 · CM · 코디 …), 없으면 전체. \`limit\` 기본 200 · 최대 500.
- 더 있으면 응답의 \`nextSince\`(또는 \`nextUpdatedSince\`)와 \`nextCursor\` 를 그대로 \`since\`(또는 \`updatedSince\`) · \`cursor\` 로 다시 보내 이어 받습니다. 더 없으면 둘 다 null 이고, 다음 호출의 since 는 포털이 정합니다(예: 이번 호출 시각).
→ \`{ requests: [{ id, empNo, name, branch, jobGroup, type, typeCode, startDate, endDate, days, reason, status, requestedAt, updatedAt, substitute?, balance? }], nextSince, nextCursor }\`
- \`type\` 은 화면 이름 그대로(「연차」 · 「오전 반차」 · 「오후 반차」 · 「대체휴일」 · 「포상휴가」 …). \`status\`: 대기 · 승인 · 반려 · 취소.
- 대체휴일: \`substitute: { workDate, checkIn, checkOut, basis: "부여 순서 추정" }\` — 신청에 「어느 근무일 대신」이 따로 저장되지 않아, 그 사람의 대체휴일 부여 근무일을 먼저 부여된 순서로 맞춘 추정입니다. 출퇴근 기록이 없으면 시각은 null, 맞출 근무일이 없으면 substitute 가 null.
- 포상휴가: \`balance: { granted: 5, used, remaining }\` — used 는 이번 신청까지(대기 · 승인)의 합이고 시프티 때 쓴 것도 셉니다. 5일은 10년 근속 기준 고정값입니다(대상자인지는 보지 않습니다).
- 시프티에서 옮겨 온 신청 기록과 지운 계정은 목록에 나오지 않습니다.

## 주말 · 휴일 근무 읽기 — 회사 연동 키 전용 (scope: attendance:weekend:read)
\`GET /attendance/weekend?from=2026-10-20&to=2026-11-19\`
- \`from\` · \`to\`: 근무 날짜(YYYY-MM-DD) 기준, 둘 다 필수. 한 번에 93일까지. 대상 날짜는 토 · 일 · 공휴일입니다.
- 한 줄 = (직원, 날짜). 근무일정 · 출근 기록 · 그날이 들어 있는 근무일정 신청(상태 무관) 중 하나라도 있으면 나옵니다.
→ \`{ from, to, rows: [{ id, empNo, name, branch, jobGroup, workDate, dayType, holidayName, scheduleId, scheduleSource, scheduledStart, scheduledEnd, breakMinutes, recognizedMinutes, checkIn, checkOut, checkOutNextDay, clockInPlace, requestId, requestKind, approvalStatus, requestedStart, requestedEnd, requestedAt, pendingRequestId, pendingRequestKind, pendingStart, pendingEnd }] }\`
- **확정 여부는 \`scheduleId\` 로 판단하세요.** \`scheduled*\` · \`breakMinutes\` · \`recognizedMinutes\` 는 지금 확정된 근무일정 기준이고, 주말 근무 엑셀의 「근무일정」 · 「휴게시간」 · 「근무인정시간」과 같은 값입니다(휴게 4.5시간↑ 30분, 9시간↑ 60분). \`scheduleSource\`: 「신청 승인」 · 「직접 수정」(승인 뒤 원장 · 본부가 시간을 고침 — \`requested*\` 와 \`scheduled*\` 가 다르면 \`scheduled*\` 가 맞습니다) · 「직접 등록」(원장 · 본부가 신청 없이 넣은 일정 — 이때 \`requestId\` · \`approvalStatus\` 는 null).
- \`requestId\` · \`requestKind\`(신규 · 수정 · 삭제) · \`approvalStatus\`(대기 · 승인 · 반려 · 취소) · \`requested*\`:
  - 근무일정이 있으면 그 일정을 만든 신청(승인된 신규 · 수정 중 승인이 가장 늦은 것)입니다. 나중에 반려 · 취소된 신청이 있어도 이 값은 바뀌지 않습니다.
  - 근무일정이 없으면 가장 최근 신청입니다(반려 · 취소 · 대기, 또는 승인된 삭제). 삭제 신청은 \`requested*\` 가 null 입니다. 원장 · 본부가 일정을 직접 지운 날은 \`approvalStatus\` 가 「승인」이어도 \`scheduleId\` 가 null 입니다 — 확정이 아닙니다.
  - 신청 없이 출근만 한 날은 모두 null 입니다.
- \`pending*\`: 그날 아직 결재를 기다리는 신청 중 가장 최근 것(위 \`requestId\` 와 다른 건)입니다. 승인되면 근무일정이 바뀝니다. 없으면 null.
- \`dayType\`: 토 · 일 · 공휴일(공휴일이 먼저). \`*Start\` · \`*End\` · \`checkIn\` · \`checkOut\` 은 KST "HH:mm"(분까지), 없으면 null. \`checkOutNextDay\` 가 true 면 자정을 넘겨 퇴근한 것입니다. \`requestedAt\` 은 ISO 시각(UTC)입니다.
- 출퇴근 기록은 한 사람 하루 한 건이라 하루 두 번 출퇴근은 생기지 않습니다(한 줄).
- \`branch\` 는 **지금 소속 지점**입니다(지점 이동 이력은 저장되지 않음). 그날 실제로 찍은 곳은 \`clockInPlace\`(지점명 · 「지점 밖 (원장 승인)」 · 「본부 처리」 등)로 확인하세요. 지점 밖 사유 원문은 나가지 않습니다.
- 관리자 · 통계 제외 지점 · 테스트 계정 · 지운 계정은 나오지 않습니다(주말 근무 엑셀과 같은 범위).

## 휴가 승인 · 반려 — 회사 연동 키 전용 (scope: leave:approve, 쓰기)
- \`POST /api/v1/leave/requests/{id}/approve\` — 본문 \`{ "approverEmpNo": "00000", "memo": "팀즈 보고에서 확인" }\`
- \`POST /api/v1/leave/requests/{id}/reject\` — 본문 \`{ "approverEmpNo": "00000", "reason": "반려 사유" }\` (reason 필수)
- id 는 휴가 신청 읽기에서 받은 신청 번호. approverEmpNo 는 실제로 확인한 분의 사번 — **재직 중인 본부 관리자만** 받는다(아니면 403 APPROVER_NOT_ADMIN · 없으면 404 APPROVER_NOT_FOUND). 결재 기록 · 신청자 알림에 이분 이름이 남는다. 신청자 본인은 403 SELF_APPROVAL.
- 결재 규칙은 **화면 결재와 같다**: 관리자 단계가 차례면 그 단계만 넘어간다(다음 단계가 남으면 status 「대기」, finalized false). 원장 단계가 차례이면 화면의 관리자 직접 처리처럼 남은 단계를 모두 닫고 최종 처리한다. 최종 승인이면 연차가 차감되고, 최종 승인 · 반려면 신청자에게 큐브티 알림이 평소처럼 간다.
- 응답: \`{ id, status: "승인" | "반려" | "대기", finalized, remainingSteps, decidedAt(ISO), approver: { empNo, name } }\`
- 이미 승인 · 반려 · 취소된 건: 409 \`ALREADY_DECIDED\` + \`status\`. 잔여 부족: 400 \`SHORT_BALANCE\`(예외 승인은 화면에서만). 같은 단계를 다른 결재자가 먼저 처리했고 신청은 다음 단계에 있으면 409 \`STEP_ALREADY_TAKEN\`(status 「대기」). 본문 오류 400 \`BAD_BODY\` · 사번 형식 400 \`BAD_APPROVER\` · 반려 사유 없음 400 \`REASON_REQUIRED\` · 신청 없음 404 \`NOT_FOUND\` · 개인 키 403 \`ORG_KEY_ONLY\`. 409 \`ALREADY_DECIDED\` 는 다시 보낼 필요가 없다(두 번 보내도 한 번만 처리된다).
- memo(승인)는 감사 기록에만 남고 신청자 알림에는 넣지 않는다. 모든 처리는 「연동 키로 결재」 감사 기록이 따로 남는다.

## 퇴사자 잔여연차 읽기 — 회사 연동 키 전용 (scope: leave:read)
\`GET /leave/balance?leaveFrom=2026-11-01&leaveTo=2026-11-30\` · 한 사람은 \`GET /leave/balance?empNo=6210\`
- 기간에 **퇴사일이 든** 사람(한 번에 366일까지). 퇴사일은 직원 관리의 퇴사일, 아직 없으면 퇴사 서류(사직원 · 연차수당 정산 신청서)의 「퇴사일자」 — 퇴사 예정자도 나옵니다(\`leaveDateSource\`: employee · document).
→ \`{ rows: [{ empNo, name, branch, jobGroup, hireDate, leaveDate, leaveDateSource, asOf, granted, used, remaining, substituteRemaining, compensatoryRemaining, basis, document, documentIncludes, settlementDays, settlementSource, needsCheck, notes }] }\`
- \`granted\` · \`used\` · \`remaining\`: **연차만**, 큐브티 계산값(본부 「연차 정산」 퇴사자 탭과 같은 계산 — 입사일 기준 발생 − 회계 기준 전년도까지 발생 − 퇴사 연도 사용, 퇴사일 기준). 반차 0.5 · 반반차 0.25 라 소수. 입사일이 없으면 null.
- \`substituteRemaining\`(대체휴일) · \`compensatoryRemaining\`(보상휴가 — 근로자의 날 보상 등): 연차와 **따로** 옵니다(부여 − 승인 사용, 일). 부여 기록이 부족해 음수로 계산되면 0 으로 주고 \`needsCheck\` · \`notes\` 로 알립니다.
- \`document\`: 큐브티 퇴사 서류에 적힌 값 \`{ documentId, docNo, title, status, statusCode, leaveDate, remaining, used, confirmedAt }\` — 서류가 없으면 null. \`confirmedAt\` 은 서명 완료 시각.
- \`documentIncludes\`: 서류의 미소진 일수가 무엇을 합친 값인지 계산값과 맞춰 본 결과 — 「연차만」 · 「연차+대체휴일」 · 「연차+대체휴일+보상휴가」 · 「연차+보상휴가」 · 「계산과 다름」.
- **\`settlementDays\` 를 정산 일수로 쓰세요**(연차 · 대체휴일 · 보상휴가 합계). 서명 완료된 서류가 있으면 서류 값 기준(서류가 연차만 적었으면 대체 · 보상 잔여를 더함, \`settlementSource: "document"\`), 없거나 서명 전이면 계산값 합계(\`"calculated"\`).
- \`needsCheck\` true 면 \`notes\` 를 보고 사람이 확인하세요(서류와 계산이 다름 · 퇴사일 불일치 · 퇴사일 뒤 승인 휴가 · 입사일 없음 등).
- 본부 · 휴지통 · 테스트 계정 · 통계 제외 지점은 나오지 않습니다. empNo 로 퇴사일이 없는 사람을 부르면 404 \`NOT_FOUND\`.

## 연봉 계약 읽기 — 회사 연동 키 전용 (scope: contract:read)
- \`GET /contracts/salary\` — 지금 유효한 계약 전체(실제 적용 끝(effectiveEndDate)이 없거나 오늘 이후, 「취소」 제외 — 작성 중 · 서명 대기 포함)
- \`GET /contracts/salary?signedSince=2026-11-01T00:00:00+09:00\` — 이 시각 이후 체결됐거나 내용 · 상태가 바뀐 계약(취소 포함). 시각대(Z 또는 +09:00) 필수
- \`GET /contracts/salary?empNo=6790\` — 한 사람의 계약 전부(지난 계약 · 퇴사자 포함)
→ \`{ mode, contracts: [{ id, docNo, title, empNo, emsId, name, branch, jobGroup, resignDate, startDate, endDate, effectiveEndDate, payUnit, annualSalary, monthlySalary, employmentType, weeklyHours, monthlyHours, dailyHours, contractKind, status, statusCode, signedAt, updatedAt, superseded, supersededBy }], nextCursor }\`
- **금액 단위는 \`payUnit\` 으로 가르세요.** \`"year"\` 면 \`annualSalary\`(연액, 원) · \`"month"\` 면 \`monthlySalary\`(월액, 원 — 계약직 월급 양식). 다른 쪽은 null 이고, 큐브티가 12 를 곱하거나 나누지 않습니다.
- \`status\`: 작성 중 · 서명 대기 · 체결 완료 · 취소(\`statusCode\`: DRAFT · SENT · APPROVED · SIGNED · EXPIRED · REJECTED). **급여에는 「체결 완료」이면서 \`superseded\` 가 false 인 계약만** 쓰세요.
- \`superseded\`: 같은 사람 · 같은 시작일로 다시 체결한 계약(금액 정정)이 있으면 옛 계약이 true, \`supersededBy\` 에 새 계약 id. 큐브티는 옛 계약을 자동으로 취소하지 않아 둘 다 「체결 완료」로 남습니다.
- **적용 기간은 \`startDate\` ~ \`effectiveEndDate\` 로 보세요.** \`effectiveEndDate\` = \`endDate\` 와 「그 사람의 다음 체결 계약(시작일이 더 늦은 것) 시작 전날」 중 이른 날(끝나는 날이 빈 옛 계약이 재계약 뒤에도 계속 유효하게 보이지 않게). 둘 다 없으면 null(끝 미정).
- \`resignDate\`: 직원 관리 퇴사일(있으면). 퇴사한 사람의 계약도 퇴사한 달 급여 계산을 위해 「지금 유효」 목록에 남습니다 — 퇴사일 뒤 달에는 쓰지 마세요.
- \`employmentType\`: 계약직(월급 양식 · 제목에 계약직 · 파트타임) / 정규직(그 밖). \`weeklyHours\`(주) · \`monthlyHours\`(월) · \`dailyHours\`(1일 소정근로시간, 계약서 「일근무시간」) 는 양식에 있을 때만(계약직 양식) — 단시간 연차수당 = 급여 ÷ monthlyHours × dailyHours × 잔여연차.
- 대상: 큐브티에서 작성한 근로 · 고용 · 파트타임 · 연봉 계약서 중 금액 칸이 있는 것. **원장 · 본부 계약은 오지 않습니다.** 시험 발송 · 외부(미가입) 계약자 · 테스트 계정 · 통계 제외 지점도 빠집니다. 모두싸인에서 옮겨 온 지난 계약(11/9 이전)은 금액 칸이 없어 오지 않습니다.
- 한 번에 1,000건까지. \`nextCursor\` 가 null 이 아니면 **같은 질의에** \`&cursor=<nextCursor>\` 를 붙여 다시 부르면 이어서 옵니다(모든 모드 공통, null 이면 끝). 날짜는 "YYYY-MM-DD", 시각은 KST(+09:00) ISO.

## 주의
- 키가 새면 프로필에서 즉시 끄고 새로 만드세요. 키를 남에게 주면 그 사람이 내 이름으로 행동하게 됩니다.
- 한도(429)에 걸린 요청이 1시간에 600회를 넘으면 — 즉 한도를 넘겨도 계속 두드리면 — 이상 사용으로 보고 키를 멈추고 본인·본부에 알립니다. 429 를 받으면 기다렸다가 다시 보내세요.
`;
  return new NextResponse(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
