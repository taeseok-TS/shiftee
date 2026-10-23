// 변경(감사) 로그 이름표·분류 — 서버·클라이언트 공용(순수 모듈, DB 의존 없음).
// QA76 #66 후속(2026-10-14 디렉터 결정): 변경 로그를 모든 관리자에게 열되, **업무 변경**과 **시스템·보안**을 나눈다.
//  · 업무 변경(모든 관리자): 직원·휴가·근무일정·출퇴근·계약·공휴일·지점·제출 요청·이모티콘 등 운영 중 생기는 기록
//  · 시스템·보안(최고관리자 전용): 비밀번호 재설정, 권한 설정, API 키, 포털 연동 설정, 출퇴근 정책, 자동 정리·마케팅 같은 시스템 작업
// 새 action 을 만들면 LABEL 에 이름표를 더하고, 보안·설정 성격이면 SYSTEM_AUDIT_ACTIONS 에도 넣는다(빠지면 업무 변경으로 분류된다).

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  // 근무일정
  SCHEDULE_TEMPLATE_CREATE: "근무 시간 종류 추가",
  SCHEDULE_TEMPLATE_UPDATE: "근무 시간 종류 수정",
  SCHEDULE_SELF_CHANGE: "원장 본인 근무일정 변경",
  SCHEDULE_DECISION: "근무일정 결재",
  SCHEDULE_CANCEL: "근무일정 신청 취소",
  SCHEDULE_IMPORT: "근무일정 엑셀 업로드",
  SCHEDULE_IMPORT_ROLLBACK: "근무일정 엑셀 업로드 되돌림",
  // 출퇴근
  ATTENDANCE_REQUEST_DECISION: "출퇴근 요청 처리",
  ATTENDANCE_REQUEST_STEP1: "출퇴근 수정 1차 승인(원장)",   // 2026-10-23 ■0-11 — 「지점 원장 → 본부」 두 단계의 원장 단계(lib/attendance-request STEP1_AUDIT)
  ATTENDANCE_CREATE: "출퇴근 기록 추가",
  ATTENDANCE_EDIT: "출퇴근 기록 수정",
  ATTENDANCE_AUTO_CLOSE: "전일 미마감 자동 마감",
  ATTENDANCE_AUTO_FILL: "출퇴근 자동 채움",
  ATTENDANCE_CLOSE_22: "퇴근 누락 처리(본인 동의)",   // 2026-10-17 근무일정 퇴근 시각 기준(종전 22시 고정 — 시각은 내용에 남는다)
  ATTENDANCE_POLICY_UPDATE: "출퇴근 정책 변경",
  ATTENDANCE_RULE_UPDATE: "근태 규칙 변경",   // 2026-10-20 퇴근 기록이 없는 날 처리 — 업무 변경(모든 관리자가 본다)
  CONTRACT_SEND_LAYOUT: "계약서 보내기 묶음 변경",   // 2026-10-20 시안 v2 — 묶음 만들기·고치기·지우기(순서·즐겨찾기는 남기지 않음)
  ROUTE_COURSE_SCHEDULE_UPDATE: "루트코스 일정 변경",   // 2026-10-21 — 교육평가 기간 기준 기수 일정표
  // 결재 대행
  APPROVAL_DELEGATE_CREATE: "원장대행 지정",
  APPROVAL_DELEGATE_REVOKE: "원장대행 해제",
  APPROVAL_RULES_UPDATE: "결재 규칙 변경",
  // 휴가
  LEAVE_BALANCE_UPDATE: "연차 수정",
  LEAVE_BALANCE_BULK: "연차 일괄 수정",
  LEAVE_DECISION: "휴가 결재",
  LEAVE_CANCEL: "휴가 취소",
  LEAVE_CANCEL_REQUEST: "휴가 취소 요청",
  LEAVE_CANCEL_DECISION: "휴가 취소 결재",
  LEAVE_CANCEL_WITHDRAW: "휴가 취소 요청 철회",
  LEAVE_CANCEL_EXPIRE: "휴가 취소 요청 기한 만료",
  LEAVE_PROXY_CREATE: "휴가 대리 등록",
  LEAVE_GRANT_AUTO: "연차 자동 부여",
  LEAVE_GRANT_MANUAL: "연차 수동 부여",
  LEAVE_ROLLOVER: "연차 이월",
  LEAVE_IMPORT: "연차 엑셀 업로드",
  LEAVE_IMPORT_ROLLBACK: "연차 엑셀 업로드 되돌림",
  LEAVE_LEDGER_PDF: "연차 대장 PDF 내려받기",
  LEAVE_TYPE_CREATE: "휴가 유형 추가",
  LEAVE_TYPE_UPDATE: "휴가 유형 수정",
  LEAVE_TYPE_DELETE: "휴가 유형 삭제",
  LEAVE_TYPE_HIDE: "기본 휴가 유형 숨김",
  // 직원
  EMPLOYEE_UPDATE: "직원 정보 수정",
  EMPLOYEE_CREATE: "직원 생성",
  EMPLOYEE_DELETE: "직원 비활성화",
  EMPLOYEE_RESIGN: "퇴사 처리",
  EMPLOYEE_RESTORE: "직원 복구",
  EMPLOYEE_BULK_UPDATE: "직원 일괄 수정",
  EMPLOYEE_BULK_DELETE: "직원 일괄 삭제",
  PASSWORD_RESET: "비밀번호 초기화(관리자)",
  PASSWORD_RESET_SELF: "비밀번호 셀프 재설정",
  DEVICE_REREGISTER: "기기 재등록(앱 재설치)",
  DEVICE_RESET: "기기 초기화",
  RESIGN_CHAT_CLEANUP: "퇴사자 채팅 정리",
  // 계약
  CONTRACT_DELETE: "계약서 삭제",
  CONTRACT_EXPORT: "계약 일괄 내려받기",
  CONTRACT_IMPORT: "계약 엑셀 업로드",
  CONTRACT_IMPORT_ROLLBACK: "계약 엑셀 업로드 되돌림",
  CONTRACT_MESSAGE_UPDATE: "전자계약 기본 메시지 변경",
  CONTRACT_ORDER_OVERRIDE: "패키지 서류별 결재 순서 변경(그 발송만)",
  CONTRACT_TEMPLATE_COPY: "계약서 양식 사본",
  CONTRACT_TEMPLATE_UPDATE: "계약서 양식 수정",
  CONTRACT_TEMPLATE_PURPOSE: "계약서 양식 용도 변경",   // 계약서 보내기 화면의 용도 카드(2026-10-17)
  CONTRACT_TEST_SEND: "시험 계약 발송",
  CONTRACT_TEST_PURGE: "시험 계약 정리",
  // 공휴일·지점
  HOLIDAY_ADD: "공휴일 등록",
  HOLIDAY_DELETE: "공휴일 삭제",
  HOLIDAY_GRANT_TOGGLE: "공휴일 부여 설정 변경",
  BRANCH_RENAME: "지점명 변경",
  BRANCH_MAIN_MANAGER: "대표원장 변경",
  // 제출 요청
  SUBMISSION_REQUEST_CREATE: "제출 요청 만들기",
  SUBMISSION_REQUEST_UPDATE: "제출 요청 수정",
  SUBMISSION_REQUEST_REMIND: "제출 요청 재알림",
  SUBMISSION_CREATE: "제출물 등록",
  SUBMISSION_UPDATE: "제출물 수정",
  SUBMISSION_DELETE: "제출물 삭제",
  SUBMISSION_CHECK: "제출물 확인",
  SUBMISSION_SHARE_ON: "제출물 공유 켬",
  SUBMISSION_SHARE_OFF: "제출물 공유 끔",
  SUBMISSION_CATEGORY_CREATE: "제출 분류 추가",
  SUBMISSION_CATEGORY_UPDATE: "제출 분류 수정",
  SUBMISSION_TARGET_GROUP_CREATE: "제출 대상 그룹 추가",
  SUBMISSION_TARGET_GROUP_UPDATE: "제출 대상 그룹 수정",
  SUBMISSION_TARGET_GROUP_DELETE: "제출 대상 그룹 삭제",
  // 이모티콘
  EMOTICON_UPLOAD: "이모티콘 올리기",
  EMOTICON_UPDATE: "이모티콘 수정",
  EMOTICON_DELETE: "이모티콘 삭제",
  EMOTICON_REORDER: "이모티콘 순서 변경",
  EMOTICON_SET_CREATE: "이모티콘 세트 추가",
  EMOTICON_SET_UPDATE: "이모티콘 세트 수정",
  EMOTICON_SET_DELETE: "이모티콘 세트 삭제",
  // 시스템·보안
  PERMISSION_SETTINGS_UPDATE: "역할별 권한 설정 변경",
  API_KEY_CREATE: "API 키 발급",
  API_KEY_REVOKE: "API 키 폐기",
  API_KEY_SUSPEND: "API 키 정지",
  API_KEY_RESUME: "API 키 재개",
  API_KEY_ALLOW: "API 키 발급 허용",
  PORTAL_SYNC_SETTING: "포털 연동 설정 변경",
  PORTAL_SYNC_DISMISS: "포털 연동 차이 무시",
  MARKETING_PUBLISHED: "마케팅 배포",
  NOTIFY_TARGETS_UPDATE: "시스템 알림 수신자 변경",
  JINHAK_INFO_ENTER: "입학정보실 입장권 발급",   // 2026-10-19 — 누가 언제 열었는지만(입장권 값은 안 남긴다)
  API_CHAT_POST: "API 키로 채팅 전송(과거 기록)",
  "시스템 알림 수신자 변경": "시스템 알림 수신자 변경",   // 2026-10-14 전 기록은 한글 문장이 코드 자리에 있었다 — 과거 호환
};

/** 최고관리자만 보는 기록 — 비밀번호·권한·API 키·포털 연동·정책·시스템 작업 */
export const SYSTEM_AUDIT_ACTIONS: readonly string[] = [
  "PASSWORD_RESET", "PASSWORD_RESET_SELF",
  "PERMISSION_SETTINGS_UPDATE",
  "API_KEY_CREATE", "API_KEY_REVOKE", "API_KEY_SUSPEND", "API_KEY_RESUME", "API_KEY_ALLOW",
  "PORTAL_SYNC_SETTING", "PORTAL_SYNC_DISMISS",
  "ATTENDANCE_POLICY_UPDATE",
  "RESIGN_CHAT_CLEANUP",
  "MARKETING_PUBLISHED",
  "NOTIFY_TARGETS_UPDATE",
  "API_CHAT_POST",
  "JINHAK_INFO_ENTER",   // 외부 연동 입장 기록 — 직원이 누를 때마다 쌓여 업무 변경 목록을 덮지 않게 시스템 쪽에
  "시스템 알림 수신자 변경",   // 과거 호환(위 참고)
];
const SYSTEM_SET = new Set(SYSTEM_AUDIT_ACTIONS);

export type AuditScope = "work" | "system";
export function isSystemAudit(action: string): boolean { return SYSTEM_SET.has(action); }
export function auditLabel(action: string): string { return AUDIT_ACTION_LABEL[action] || action; }

// ─── 종류별 고르기(2026-10-23 본부 요청 ■3) — 변경 로그에 큐브티 근태 · 인사와 상관없는 기록(자료 제출 · 이모티콘)이 섞여 보였다.
// 작업 코드 앞머리로 나눈다(새 코드도 앞머리만 맞으면 따라온다). 기본은 「근태 · 인사」 = 큐브티워크 기록을 뺀 전부.
export type AuditKind = "hr" | "employee" | "attendance" | "schedule" | "leave" | "approval" | "contract" | "org" | "work" | "all";
export const AUDIT_KIND_PREFIX: Record<Exclude<AuditKind, "hr" | "all">, string[]> = {
  employee: ["EMPLOYEE_", "DEVICE_", "PASSWORD_RESET", "RESIGN_"],
  attendance: ["ATTENDANCE_"],
  schedule: ["SCHEDULE_"],
  leave: ["LEAVE_"],
  approval: ["APPROVAL_"],
  contract: ["CONTRACT_", "ROUTE_COURSE_"],
  org: ["HOLIDAY_", "BRANCH_"],
  work: ["SUBMISSION_", "EMOTICON_"],
};
/** 기본 「근태 · 인사 전체」(hr)에서 빼는 앞머리 — 큐브티워크 기록 + 근태 · 인사와 상관없는 시스템 작업(마케팅 배포 · 입학정보실 입장, 10/23 검증 K) */
export const AUDIT_HR_EXCLUDE_PREFIX: readonly string[] = [...AUDIT_KIND_PREFIX.work, "MARKETING_", "JINHAK_"];
export const AUDIT_KIND_OPTIONS: { key: AuditKind; label: string }[] = [
  { key: "hr", label: "근태 · 인사 전체" },
  { key: "employee", label: "직원" },
  { key: "attendance", label: "출퇴근" },
  { key: "schedule", label: "근무일정" },
  { key: "leave", label: "휴가" },
  { key: "approval", label: "결재 규칙 · 원장대행" },
  { key: "contract", label: "전자계약" },
  { key: "org", label: "공휴일 · 지점" },
  { key: "work", label: "큐브티워크(자료 제출 · 이모티콘)" },
  { key: "all", label: "모든 기록" },
];
export function isAuditKind(v: string | null | undefined): v is AuditKind {
  return !!v && AUDIT_KIND_OPTIONS.some((o) => o.key === v);
}
