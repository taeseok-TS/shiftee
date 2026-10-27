"use client";
// 결재 › 결재함 머리 + 알약 탭 한 줄(2026-10-21 본부 시안 R11) — 옛 위 탭(휴가·근무일정 / 계약 / 처리한 요청)과
// 안쪽 탭(휴가 · 근무일정 · 휴가 취소 · 출퇴근 요청) 두 겹을 한 줄로. 맨 앞 「결재 대기」 = 종류 상관없이 내가 처리할 것 모두.
// 결재함 화면(/admin/leave-approvals)은 탭을 화면 안에서 바꾸고(onSelect), 처리한 요청 화면은 링크로 돌아온다.
import { PageHead, PillTabs, type PillTab } from "@/components/kit";

export type ApprovalTab = "all" | "leave" | "schedule" | "cancel" | "attendance" | "contract" | "waiting" | "decided";

const LABEL: Record<ApprovalTab, string> = {
  // 「원장 승인 전」 = 아직 본부 차례가 아닌 건(버튼 없이 보기만, 2026-10-27 이예지 ⑬) — 「결재 대기」 숫자에는 들어가지 않는다
  all: "결재 대기", leave: "휴가", schedule: "근무 변경", cancel: "휴가 취소", attendance: "출퇴근 수정", contract: "계약", waiting: "원장 승인 전", decided: "처리한 요청",
};

export default function ApprovalsHeader({ active, counts, onSelect }: {
  active: ApprovalTab;
  counts?: Partial<Record<Exclude<ApprovalTab, "decided">, number>>;
  onSelect?: (t: ApprovalTab) => void;
}) {
  const total = counts?.all;
  const tabs: PillTab[] = (Object.keys(LABEL) as ApprovalTab[]).map((k) => ({
    key: k, label: LABEL[k],
    count: k === "decided" ? null : counts?.[k] ?? null,
    hot: k === "all",
    // 처리한 요청은 다른 화면, 나머지는 결재함 안 탭(결재함이 아닌 화면에서는 링크로 돌아간다)
    href: k === "decided" ? "/admin/requests?who=decided" : onSelect ? undefined : `/admin/leave-approvals?tab=${k}`,
  }));
  return (
    <>
      <PageHead crumb="결재 › 결재함" title="결재함" note={typeof total === "number" ? `결재 대기 ${total}건` : undefined} />
      <PillTabs tabs={tabs} value={active} onChange={(k) => onSelect?.(k as ApprovalTab)} />
    </>
  );
}
