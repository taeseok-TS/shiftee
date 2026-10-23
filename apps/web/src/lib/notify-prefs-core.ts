// 원장 알림 설정(2026-10-23 디렉터 결정 — 원장 「설정 › 환경설정」) — 화면·서버가 함께 쓰는 순수 모듈(prisma 없음).
//
// 저장: /api/me/prefs 의 `notify` 키(AppSetting `userpref:<userId>` JSON 안). 새 표·컬럼 없음.
//   { approvalRequest: boolean, approvalEmail: boolean, staffChange: boolean } — 없는 값은 켬(true).
// 적용: **원장(MANAGER) 계정에만**. 직원·관리자는 이 값과 상관없이 종전대로 받는다.
//   · approvalRequest — 결재 차례가 왔다는 봇 DM·앱 푸시(휴가·근무일정·휴가 취소·출퇴근 요청·기기 변경·전자계약 결재 요청·미결재 리마인더)
//   · approvalEmail   — 같은 결재 요청 중 메일로 가는 것(지금은 전자계약 결재(서명) 요청 메일뿐)
//   · staffChange     — 담당 지점 직원 입사 등록·퇴사 처리·비활성화 봇 DM(lib/staff-change-notify)
// 본부 「결재 알림 강제」(AppSetting forceApprovalNotify="true")가 켜져 있으면 approvalRequest·approvalEmail 은 끌 수 없다
//   (화면 잠김 + 서버가 무시하고 보냄). staffChange 는 강제 대상이 아니다.

export type ManagerNotifyPrefs = {
  approvalRequest: boolean;
  approvalEmail: boolean;
  staffChange: boolean;
};

export const MANAGER_NOTIFY_KEYS = ["approvalRequest", "approvalEmail", "staffChange"] as const;
export type ManagerNotifyKey = (typeof MANAGER_NOTIFY_KEYS)[number];

export const DEFAULT_MANAGER_NOTIFY: ManagerNotifyPrefs = { approvalRequest: true, approvalEmail: true, staffChange: true };

/** 저장된 값(무엇이든) → 세 칸 모두 채운 설정. false 로 적힌 칸만 끔, 나머지는 켬. */
export function parseManagerNotify(raw: unknown): ManagerNotifyPrefs {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return {
    approvalRequest: o.approvalRequest !== false,
    approvalEmail: o.approvalEmail !== false,
    staffChange: o.staffChange !== false,
  };
}
