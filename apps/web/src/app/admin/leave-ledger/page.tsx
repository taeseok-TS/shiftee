import LeaveLedgerView from "@/components/leave/LeaveLedgerView";

// 관리자 — 전 직원의 연차 대장 + PDF 내려받기(디렉터 9/11). 관리자 레이아웃이 ADMIN 만 들인다.
export default function AdminLeaveLedgerPage() {
  return <LeaveLedgerView backHref="/admin/leave" backLabel="휴가 관리로" />;
}
