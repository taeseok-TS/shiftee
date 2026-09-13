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

## 주의
- 키가 새면 프로필에서 즉시 끄고 새로 만드세요. 키를 남에게 주면 그 사람이 내 이름으로 행동하게 됩니다.
- 1시간에 1,500회(받아들인 요청 기준)를 넘으면 이상 사용으로 보고 키를 멈추고 본인·본부에 알립니다.
`;
  return new NextResponse(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}
