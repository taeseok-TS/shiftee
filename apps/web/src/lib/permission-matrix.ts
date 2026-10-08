// 권한 현황(2026-10-08 QA76 #39, 본부 답변 #9 「10/31까지는 시프티 설정값으로 고정 + 권한 현황 보기 전용, 켜고 끄는 화면은 11월」)
// 이 표는 **설정이 아니라 설명**이다 — 실제 권한은 각 API 라우트의 검사(session.role·getManagerBranches·결재선)가 정한다.
// 라우트를 바꾸면 이 표도 같이 고친다. 「근거」 열이 그 라우트다. 시프티 현재 설정과 다른 줄은 diff 에 적는다.
export type Grant = "all" | "branch" | "self" | "no" | "na" | string;   // all=전체, branch=담당 지점, self=본인만, no=불가, na=해당 없음, 그 밖은 설명 문구
export type PermRow = { feature: string; admin: Grant; manager: Grant; employee: Grant; note?: string; diff?: string; basis: string };
export type PermSection = { title: string; rows: PermRow[] };

export const GRANT_LABEL: Record<string, string> = { all: "전체", branch: "담당 지점", self: "본인만", no: "불가", na: "—" };

export const PERMISSION_MATRIX: PermSection[] = [
  { title: "직원 관리", rows: [
    { feature: "직원 목록·정보 보기", admin: "all", manager: "branch", employee: "이름·지점만(전체)", note: "직원은 동료의 이름·지점 목록만(연락처·급여 등 개인정보 없음), 상세는 내 프로필만", basis: "api/employees GET, api/profile" },
    { feature: "직원 등록(계정 만들기)", admin: "all", manager: "no", employee: "no", note: "시프티 「직원 추가 OFF」와 같음(10/7 본부만으로 고침)", basis: "api/employees POST" },
    { feature: "직원 정보 수정", admin: "all", manager: "branch", employee: "self", note: "원장은 지점 변경·관리자 계정 수정 불가, 직원은 내 프로필 일부만", basis: "api/employees/[id] PATCH, api/profile PATCH" },
    { feature: "직원 삭제(휴지통)·복구", admin: "all", manager: "no", employee: "no", note: "관리자 계정 삭제는 메인 관리자만", basis: "api/employees/[id]/delete·restore" },
    { feature: "엑셀 일괄 등록·수정", admin: "all", manager: "branch", employee: "no", note: "원장은 담당 지점 기존 직원 수정만(신규 등록·지점 열 불가)", basis: "api/employees/bulk" },
    { feature: "직원 명부 엑셀 내려받기", admin: "all", manager: "branch", employee: "no", basis: "api/employees/export" },
    { feature: "비밀번호 초기화·퇴사 처리·휴지통 목록", admin: "all", manager: "no", employee: "no", note: "관리자 계정은 메인 관리자만(비밀번호·퇴사 모두)", basis: "api/employees/[id]/reset-password·resign, employees/archived" },
    { feature: "기기 초기화(1인 1기기 잠금 해제)", admin: "all", manager: "branch", employee: "no", note: "원장은 담당 지점 직원만(다른 원장·본인 불가)", basis: "api/employees/[id]/device DELETE" },
  ] },
  { title: "출퇴근", rows: [
    { feature: "출퇴근 찍기(앱)", admin: "na", manager: "self", employee: "self", note: "본부 직원은 큐브티 출퇴근 대상이 아님", basis: "api/attendance/clock-in·clock-out" },
    { feature: "출퇴근 기록 보기(달력·목록)", admin: "all", manager: "branch", employee: "오늘 상태만(앱)", note: "직원은 앱에서 오늘 출근·퇴근과 누락만 본다. 웹 /attendance 의 본인 월별 기록 표는 숨김(2026-10-08 본부 답변 — 시프티 「직원 본인 출퇴근기록 열람 OFF」와 같게). 기록 수정은 앱에서 요청", basis: "api/attendance/board, app/(dashboard)/attendance(EMPLOYEE 가림)" },
    { feature: "출퇴근 기록 직접 수정·추가·누락 보정", admin: "all", manager: "no", employee: "no", note: "시프티 「원장 직접 수정 OFF」와 같음 — 원장은 수정 요청 승인만", basis: "api/attendance POST·[id] PATCH" },
    { feature: "출퇴근 요청 승인(지점 밖·사진·기록 수정·퇴근 누락)", admin: "all", manager: "branch", employee: "no", note: "본부처리·기기변경 요청은 본부만, 본인 요청은 처리 불가", basis: "lib/attendance-request canDecide" },
    { feature: "출퇴근 통계", admin: "all", manager: "branch", employee: "self", basis: "api/attendance/stats" },
    { feature: "주말 근무 엑셀", admin: "all", manager: "no", employee: "no", basis: "api/attendance/weekend-export" },
  ] },
  { title: "근무일정", rows: [
    { feature: "일정 보기", admin: "all", manager: "branch", employee: "self", note: "시프티 「직원 동료 일정 열람 OFF」와 같음", basis: "api/schedule GET" },
    { feature: "일정 추가·수정·삭제", admin: "all", manager: "branch", employee: "no", note: "원장은 같은 지점 다른 원장·본인 일정도(본부 답변 #7), 관리자 일정은 불가. 직원은 신청으로", basis: "lib/schedule-guard" },
    { feature: "일정 일괄 생성", admin: "all", manager: "branch", employee: "no", basis: "api/schedule/bulk" },
    { feature: "근무일정 템플릿 관리", admin: "all", manager: "no", employee: "no", diff: "시프티는 원장 ON — 큐브티는 본부만(지점 전용 템플릿은 본부가 지점을 지정). 11월 설정 화면에서 결정", basis: "api/schedule-templates POST·PATCH·DELETE" },
    { feature: "근무일정 신청·수정/삭제 요청", admin: "self", manager: "self", employee: "self", note: "원장·본부도 신청할 수는 있으나 직접 등록이 기본(원장 신청은 메인 원장 → 본부 결재)", basis: "api/schedule-requests" },
    { feature: "일정 요청 결재", admin: "all", manager: "branch", employee: "no", note: "평일: 원장 1단계 / 주말·공휴일: 원장 → 본부(본부 답변 #4). 사람을 못박은 단계는 그 사람(+원장대행)만", basis: "api/schedule-requests/[id]/approve" },
  ] },
  { title: "휴가", rows: [
    { feature: "휴가 신청·취소 요청", admin: "na", manager: "self", employee: "self", note: "본부 직원은 큐브티 휴가 대상이 아님(본부 답변 #2)", basis: "api/leave POST, [id]/cancel-request" },
    { feature: "휴가 결재", admin: "all", manager: "branch", employee: "no", note: "직원: 원장 → 본부 / 원장: 본부 1단계(#1) / 원장대행 가능, 본인 건은 불가", basis: "api/leave/[id]/approve, lib/approval-delegate" },
    { feature: "남의 휴가 대리 등록", admin: "all", manager: "no", employee: "no", note: "시프티 「원장 휴가 직접 등록 OFF」·본부 답변 #28과 같음", basis: "api/leave POST targetUserId" },
    { feature: "지점 휴가 목록 보기", admin: "all", manager: "branch", employee: "self", note: "시프티 「직원 동료 휴가 열람 OFF」와 같음", basis: "api/leave GET" },
    { feature: "연차 잔여 조정·총 연차·연도 전환·일괄 업로드", admin: "all", manager: "no", employee: "no", note: "10/8 고침: 종전엔 원장도 API 로 아무 직원이나 조정할 수 있었다", basis: "api/leave/balance PATCH·bulk, api/leave/rollover" },
    { feature: "연차 자동계산(다시 계산)", admin: "all", manager: "branch", employee: "no", basis: "api/leave/balance/recalc" },
    { feature: "휴가 리포트", admin: "all", manager: "branch", employee: "no", basis: "api/leave/report" },
    { feature: "연차 대장", admin: "all", manager: "branch", employee: "self", note: "대장 PDF 내려받기는 본부만", basis: "api/leave/ledger, ledger/pdf" },
    { feature: "보상휴가·대체휴일 종류별 잔여·수동 조정", admin: "all", manager: "no", employee: "no", note: "직원 화면에는 없음(#50)", basis: "api/leave/grants" },
    { feature: "원장대행 지정", admin: "all", manager: "no", employee: "no", basis: "api/approval-delegates" },
  ] },
  { title: "전자계약", rows: [
    { feature: "계약서 작성·발송", admin: "all", manager: "no", employee: "no", note: "원장은 API 로 담당 지점 직원의 임시저장(초안)만 만들 수 있고 발송은 못 한다(원장 화면에는 작성 버튼 없음)", basis: "api/contracts POST(초안), [id] PATCH·bundle send = 본부" },
    { feature: "외부(미가입) 계약·나에게 테스트 발송", admin: "all", manager: "no", employee: "no", basis: "api/contracts POST" },
    { feature: "계약 목록 보기", admin: "all", manager: "branch", employee: "self", note: "원장은 직원전용 문서(비밀유지·개인정보동의서)·외부 계약 제외", basis: "api/contracts GET" },
    { feature: "결재·서명", admin: "결재선에 있을 때", manager: "결재선에 있을 때", employee: "본인 서명", note: "본인 서명은 비밀번호 확인 뒤(#20)", basis: "api/contracts/[id]/sign, my-approvals" },
    { feature: "수정·재발송·회수·삭제", admin: "all", manager: "no", employee: "no", note: "완료본은 삭제 불가(시험 문서 제외)", basis: "api/contracts/[id] PATCH·DELETE" },
    { feature: "결재자 바꾸기", admin: "all", manager: "branch", employee: "no", note: "원장은 자기 자신으로 지정 불가", basis: "api/contracts/[id]/approval-steps/[stepId]" },
    { feature: "완료본 ZIP·입력값 엑셀", admin: "all", manager: "no", employee: "no", basis: "api/contracts/export" },
    { feature: "계약 템플릿 관리", admin: "all", manager: "no", employee: "no", basis: "api/contract-templates" },
  ] },
  { title: "지점·설정", rows: [
    { feature: "지점 관리(좌표·통계 포함 여부)", admin: "all", manager: "no", employee: "no", note: "원장은 지점 목록 보기만(직원은 목록도 없음)", basis: "api/branches" },
    { feature: "공휴일 관리(대체휴무 부여 지정 포함)", admin: "all", manager: "no", employee: "no", basis: "api/holidays" },
    { feature: "시스템 설정·감사 로그·봇 브리핑·이모티콘·API 키", admin: "all", manager: "no", employee: "no", note: "관리자 계정 관리는 메인 관리자만", basis: "app/admin/*" },
    { feature: "개선 제안", admin: "제출·관리", manager: "제출", employee: "제출", basis: "api/suggestions" },
  ] },
];
