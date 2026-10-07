// 시스템이 결재 단계를 닫을 때 남기는 문구(2026-10-07) — 닫는 곳과 「요청 한눈에」(lib/request-feed)가 같은 값을 쓴다.
// 단계에 결재자가 미리 박힌 채로 닫히므로, 이 문구로 「사람이 결재한 것」과 구분한다. 문구를 바꾸면 옛 문구를 LEGACY 에 남긴다.
export const CLOSE_REQUESTER_CANCEL = "신청 취소";   // 신청자가 휴가·근무일정 신청을 취소
export const CLOSE_WITHDRAW = "요청 철회";           // 신청자가 휴가 취소 요청을 철회
export const CLOSE_EXPIRED = "기한 만료";            // 휴가 취소 결재 기한이 지남
const LEGACY = ["신청자 취소"];                      // 2026-09-09 하루 동안 근무일정 취소에 쓰였다

export const SYSTEM_CLOSE_COMMENTS: string[] = [CLOSE_REQUESTER_CANCEL, CLOSE_WITHDRAW, CLOSE_EXPIRED, ...LEGACY];
