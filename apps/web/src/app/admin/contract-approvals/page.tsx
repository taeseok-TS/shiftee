import { redirect } from "next/navigation";

// 계약 결재는 결재함 한 화면의 「계약」 탭으로 합쳤다(2026-10-21 본부 시안 R11) — 옛 주소(메일·알림 링크)는 그 탭으로 넘긴다
export default function ContractApprovalsPage() {
  redirect("/admin/leave-approvals?tab=contract");
}
