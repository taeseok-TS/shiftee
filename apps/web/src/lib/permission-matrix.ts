// 권한 현황(2026-10-08 QA76 #39, 본부 답변 #9 「10/31까지는 시프티 설정값으로 고정 + 권한 현황 보기 전용, 켜고 끄는 화면은 11월」)
// 이 표는 **설정이 아니라 설명**이다 — 실제 권한은 각 API 라우트의 검사(session.role·getManagerBranches·결재선)가 정한다.
// 라우트를 바꾸면 이 표도 같이 고친다. 「basis」 는 그 라우트(개발용 — **화면에는 보이지 않는다**). 시프티 현재 설정과 다른 줄은 diff 에 적는다.
// 화면 말(2026-10-23 본부 요청 ■0-2 · 시안 S3): 기능 이름 · 참고는 사람 말로 결과만 — 개발용 주소 · 작업 기록 번호(「본부 답변 #5」 「10/7 고침」) ·
//   템플릿 · 일괄 생성 · 통계 · API 같은 말은 쓰지 않는다. 근거(본부 답변 번호 등)는 이 주석과 basis 에만 남긴다.
export type Grant = "all" | "branch" | "self" | "no" | "na" | string;   // all=전체, branch=담당 지점, self=본인, no=안 됨, na=해당 없음, 그 밖은 설명 문구
export type PermRow = { feature: string; admin: Grant; manager: Grant; employee: Grant; note?: string; diff?: string; basis: string };
export type PermSection = { title: string; rows: PermRow[] };

export const GRANT_LABEL: Record<string, string> = { all: "전체", branch: "담당 지점", self: "본인", no: "안 됨", na: "—" };

export const PERMISSION_MATRIX: PermSection[] = [
  { title: "직원 관리", rows: [
    { feature: "직원 목록 · 정보 보기", admin: "all", manager: "branch", employee: "이름 · 지점만", note: "직원은 동료 연락처 · 급여를 볼 수 없음, 상세는 내 정보만", basis: "api/employees GET, api/profile" },
    // 10/7 본부만으로 고침(시프티 「직원 추가 OFF」와 같음)
    { feature: "직원 등록(계정 만들기)", admin: "all", manager: "no", employee: "no", note: "본부만", basis: "api/employees POST" },
    { feature: "직원 정보 고치기", admin: "all", manager: "branch", employee: "self", note: "원장은 지점 옮기기 · 관리자 계정 고치기 안 됨, 직원은 내 정보 일부만", basis: "api/employees/[id] PATCH, api/profile PATCH" },
    { feature: "직원 삭제 · 되살리기", admin: "all", manager: "no", employee: "no", note: "관리자 계정 삭제는 최고 관리자만", basis: "api/employees/[id]/delete·restore" },
    { feature: "엑셀로 한꺼번에 등록 · 고치기", admin: "all", manager: "branch", employee: "no", note: "원장은 담당 지점 직원 고치기만(새 계정 · 지점 옮기기는 안 됨)", basis: "api/employees/bulk" },
    { feature: "직원 명부 엑셀 내려받기", admin: "all", manager: "branch", employee: "no", basis: "api/employees/export" },
    { feature: "비밀번호 초기화 · 퇴사 처리 · 휴지통 보기", admin: "all", manager: "no", employee: "no", note: "관리자 계정은 최고 관리자만", basis: "api/employees/[id]/reset-password·resign, employees/archived" },
    { feature: "휴대폰 기기 초기화(1인 1기기 잠금 풀기)", admin: "all", manager: "branch", employee: "no", note: "원장은 담당 지점 직원만(다른 원장 · 본인은 안 됨)", basis: "api/employees/[id]/device DELETE" },
  ] },
  { title: "출퇴근", rows: [
    { feature: "출퇴근 찍기(앱)", admin: "na", manager: "self", employee: "self", note: "본부 직원은 큐브티 출퇴근 대상이 아님", basis: "api/attendance/clock-in·clock-out" },
    // 2026-10-08 본부 답변 #3 — 시프티 「직원 본인 출퇴근기록 열람 OFF」와 같게
    { feature: "출퇴근 기록 보기(달력 · 목록)", admin: "all", manager: "branch", employee: "오늘 상태만(앱)", note: "직원은 앱에서 오늘 출근 · 퇴근 상태와 누락만 봄. 「본인 출퇴근 기록 열람(웹)」을 켜면 웹에서도 지난 기록을 봄. 기록 고치기는 앱에서 요청", basis: "api/attendance/board, app/(dashboard)/attendance(EMPLOYEE 가림)" },
    // #53 「출퇴근 기록 수정 권한은 무조건 본부만」 · 시프티 「원장 직접 수정 OFF」
    { feature: "출퇴근 기록 직접 고치기 · 넣기", admin: "all", manager: "no", employee: "no", note: "원장은 고치기 요청 승인만", basis: "api/attendance POST·[id] PATCH" },
    { feature: "출퇴근 요청 승인(지점 밖 · 사진 · 기록 고치기 · 퇴근 누락)", admin: "all", manager: "branch", employee: "no", note: "기록 고치기 · 퇴근 누락 = 원장 → 본부(원장은 상태만 보고 1차 승인, 본부가 시각 확인 후 최종 승인). 본부에 맡긴 요청 · 기기 변경은 본부만, 본인 요청은 처리 안 됨", basis: "lib/attendance-request canDecide · api/attendance-requests/[id]" },
    { feature: "기간별 출퇴근 합계", admin: "all", manager: "branch", employee: "self", basis: "api/attendance/stats" },
    // 2026-10-23 ■0-11 — 출퇴근 시각 · 근무시간은 본부만(원장은 「출퇴근 시각 보기」 스위치)
    { feature: "찍은 시각 · 일한 시간 보기", admin: "all", manager: "no", employee: "no", note: "원장 · 직원 화면은 출근 · 지각 · 퇴근 같은 상태만. 원장은 「출퇴근 시각 보기」를 켜면 담당 지점", basis: "permission manager.viewClockTimes" },
    { feature: "근로시간 리포트", admin: "all", manager: "no", employee: "no", note: "본부만", basis: "app/admin/work-report, api/attendance/work-report" },
    { feature: "주말 근무 엑셀", admin: "all", manager: "no", employee: "no", basis: "api/attendance/weekend-export" },
  ] },
  { title: "근무일정", rows: [
    // 시프티 「직원 동료 일정 열람 OFF」와 같음
    { feature: "일정 보기", admin: "all", manager: "branch", employee: "self", basis: "api/schedule GET" },
    // 본부 답변 #7 — 원장은 같은 지점 다른 원장 · 본인 일정도
    { feature: "일정 넣기 · 고치기 · 지우기", admin: "all", manager: "branch", employee: "no", note: "원장은 같은 지점 다른 원장 · 본인 일정도(관리자 일정은 안 됨). 직원은 요청으로", basis: "lib/schedule-guard" },
    { feature: "여러 날 한 번에 넣기", admin: "all", manager: "branch", employee: "no", basis: "api/schedule/bulk" },
    { feature: "근무 시간 종류 관리", admin: "all", manager: "no", employee: "no", diff: "시프티는 원장도 됨 — 큐브티는 본부만(지점 전용 종류는 본부가 지점을 정함)", basis: "api/schedule-templates POST·PATCH·DELETE" },
    { feature: "근무 변경 요청(넣기 · 고치기 · 지우기)", admin: "self", manager: "self", employee: "self", note: "원장 · 본부도 요청할 수 있으나 직접 넣는 것이 기본(원장 요청은 대표원장 → 본부 결재)", basis: "api/schedule-requests" },
    // 10/15 디렉터 결정 — 직원 평일 · 주말 · 공휴일 모두 원장 1단계
    { feature: "근무 변경 요청 결재", admin: "all", manager: "branch", employee: "no", note: "결재 규칙 화면을 따름(기본: 직원 요청은 원장 1단계). 사람을 정해 둔 단계는 그 사람(+원장대행)만", basis: "api/schedule-requests/[id]/approve, lib/approval-rules" },
  ] },
  { title: "휴가", rows: [
    // 본부 답변 #2
    { feature: "휴가 신청 · 취소 요청", admin: "na", manager: "self", employee: "self", note: "본부 직원은 큐브티 휴가 대상이 아님", basis: "api/leave POST, [id]/cancel-request" },
    // 원장 휴가 = 본부 1단계(#1)
    { feature: "휴가 결재", admin: "all", manager: "branch", employee: "no", note: "결재 규칙 화면을 따름(기본: 직원 원장 → 본부 / 원장 본부 1단계). 직원 · 지점 예외 · 원장대행 가능, 본인 건은 안 됨", basis: "api/leave/[id]/approve, lib/approval-rules, lib/approval-delegate" },
    // 시프티 「원장 휴가 직접 등록 OFF」 · 본부 답변 #28
    { feature: "남의 휴가 대신 넣기", admin: "all", manager: "no", employee: "no", note: "본부만", basis: "api/leave POST targetUserId" },
    // 시프티 「직원 동료 휴가 열람 OFF」와 같음
    { feature: "지점 휴가 목록 보기", admin: "all", manager: "branch", employee: "self", basis: "api/leave GET" },
    // 10/8 고침: 종전엔 원장도 API 로 아무 직원이나 조정할 수 있었다
    { feature: "연차 잔여 조정 · 총 연차 · 연도 넘기기 · 엑셀로 한꺼번에", admin: "all", manager: "no", employee: "no", note: "본부만", basis: "api/leave/balance PATCH·bulk, api/leave/rollover" },
    { feature: "연차 다시 계산", admin: "all", manager: "branch", employee: "no", basis: "api/leave/balance/recalc" },
    { feature: "휴가 리포트", admin: "all", manager: "branch", employee: "no", basis: "api/leave/report" },
    { feature: "연차 대장", admin: "all", manager: "branch", employee: "self", note: "대장 PDF 내려받기는 본부만", basis: "api/leave/ledger, ledger/pdf" },
    // #219-1 — 시프티 사용 내역 이관 전에는 꺼 둔다
    { feature: "잔여 연차 숫자 보기", admin: "all", manager: "branch", employee: "self", note: "「잔여 연차 숫자 보기」 스위치를 따름. 꺼도 잔여를 넘는 신청은 막음", basis: "lib/permission-settings canSeeLeaveBalance — api/me/dashboard-stats·leave/balance·leave/ledger·leave/days·employees" },
    // #50 · #219-7
    { feature: "보상휴가 · 대체휴일 종류별 잔여 · 직접 조정", admin: "all", manager: "no", employee: "no", note: "본부 화면만. 잔여를 넘는 신청 막기는 「보상휴가 · 대체휴일 잔여 초과 신청 막기」 스위치를 따름(켰을 때만 신청 창에 잔여가 보임)", basis: "api/leave/grants, lib/leave-limit" },
    // #57~#60 — 재직자 = 그해 회계 기준 발생 − 사용, 퇴사자 = 입사일 기준 총 발생 − 회계 기준 전년도까지 누적 − 당해 사용
    { feature: "연차 정산(재직자 미사용 · 퇴사자) · 정산 엑셀", admin: "all", manager: "no", employee: "no", note: "휴가 관리 「연차 정산」 탭. 일수까지만(금액 없음)", basis: "api/leave/settlement" },
    { feature: "원장대행 정하기", admin: "all", manager: "no", employee: "no", basis: "api/approval-delegates" },
  ] },
  { title: "전자계약", rows: [
    { feature: "계약서 쓰기 · 보내기", admin: "all", manager: "no", employee: "no", note: "본부만(원장 화면에는 쓰기 버튼이 없음)", basis: "api/contracts POST(초안 — 원장도 담당 지점 직원 임시저장은 됨), [id] PATCH·bundle send = 본부" },
    { feature: "외부(가입 안 한 분) 계약 · 나에게 시험 보내기", admin: "all", manager: "no", employee: "no", basis: "api/contracts POST" },
    { feature: "계약 목록 보기", admin: "all", manager: "branch", employee: "self", note: "원장은 직원 전용 서류(비밀유지 · 개인정보 동의서) · 외부 계약 빼고", basis: "api/contracts GET" },
    // 2026-10-17 디렉터 결정 — 원장 열람만, 내려받기 불가
    { feature: "서명 중 · 체결된 계약서 보기", admin: "all", manager: "담당 지점 · 결재할 때(보기만)", employee: "self", note: "원장은 화면에서 보기만 — 내려받기 안 됨. 직원 전용 서류 · 외부 계약 · 시험 서류는 빼고", basis: "api/contracts/[id]/signed-document, lib/contract-access" },
    // #20 · #220-3
    { feature: "결재 · 서명", admin: "결재 순서에 있을 때", manager: "결재 순서에 있을 때", employee: "본인 서명", note: "모두 비밀번호 확인 뒤", basis: "api/contracts/[id]/sign, my-approvals" },
    { feature: "고치기 · 다시 보내기 · 회수 · 지우기", admin: "all", manager: "no", employee: "no", note: "체결된 계약서는 지울 수 없음(시험 서류 빼고)", basis: "api/contracts/[id] PATCH·DELETE" },
    { feature: "결재자 바꾸기", admin: "all", manager: "branch", employee: "no", note: "원장은 자기 자신으로는 안 됨", basis: "api/contracts/[id]/approval-steps/[stepId]" },
    { feature: "체결본 묶음(ZIP) · 입력값 엑셀", admin: "all", manager: "no", employee: "no", basis: "api/contracts/export" },
    { feature: "계약서 양식 관리", admin: "all", manager: "no", employee: "no", basis: "api/contract-templates" },
  ] },
  { title: "지점 · 설정", rows: [
    { feature: "지점 관리(출근 위치 · 인원 숫자에 넣기)", admin: "all", manager: "no", employee: "no", note: "원장은 지점 목록 보기만(직원은 목록도 없음)", basis: "api/branches" },
    { feature: "공휴일 관리(대체휴무 포함)", admin: "all", manager: "no", employee: "no", basis: "api/holidays" },
    // 시스템 · 보안 기록 탭은 메인 관리자만(2026-10-14 #66 후속)
    { feature: "변경 로그", admin: "all", manager: "no", employee: "no", note: "로그인 · 보안 기록은 최고 관리자만", basis: "app/admin/audit, api/admin/audit" },
    { feature: "큐브티워크 이모티콘 관리", admin: "all", manager: "no", employee: "no", note: "큐브티워크 › 이모티콘", basis: "app/work/emoticons, api/admin/emoticons" },
    // 2026-10-23 ■0-3 — 개발자 메뉴(봇 브리핑 · API 키 · API 테스트) · 환경설정은 메인 관리자만
    { feature: "환경설정 · 봇 브리핑 · 외부 연동 키", admin: "최고 관리자만", manager: "no", employee: "no", note: "관리자 계정 관리 · 로그인 실패 기록도 최고 관리자만", basis: "app/admin/settings·bot·api-keys·test-api (layout isSuperAdmin), api/admin/bot-briefings·notify-policy·api-keys" },
    { feature: "개선 제안", admin: "보내기 · 관리", manager: "보내기", employee: "보내기", basis: "api/suggestions" },
  ] },
];

/** 켜고 끄는 권한 상태를 표에 반영 — 스위치가 걸린 줄만(화면 · 서버 모두 쓰는 순수 함수) */
export function applyToggles(row: PermRow, s: Partial<Record<string, boolean>>): PermRow {
  const r = { ...row };
  if (row.feature === "출퇴근 기록 보기(달력 · 목록)") {
    r.manager = s["manager.viewAttendance"] ? "branch" : "본인(설정 끔)";
    r.employee = s["employee.viewOwnAttendance"] ? "본인(웹 · 앱)" : "오늘 상태만(앱)";
  }
  if (row.feature === "찍은 시각 · 일한 시간 보기") {
    r.manager = s["manager.viewClockTimes"] ? "branch" : "no";
  }
  if (row.feature === "기간별 출퇴근 합계") {
    r.manager = s["manager.viewAttendance"] ? "branch" : "본인(설정 끔)";
  }
  if (row.feature === "잔여 연차 숫자 보기") {   // #219-1
    r.manager = s["employee.viewLeaveBalance"] ? "branch" : "숨김(연차 정리 중)";
    r.employee = s["employee.viewLeaveBalance"] ? "self" : "숨김(연차 정리 중)";
  }
  if (row.feature === "일정 넣기 · 고치기 · 지우기" || row.feature === "여러 날 한 번에 넣기") {
    r.manager = s["manager.editSchedule"] ? "branch" : "요청만(설정 끔)";
  }
  return r;
}
