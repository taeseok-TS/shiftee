import LeaveLedgerView from "@/components/leave/LeaveLedgerView";

// 직원 — 본인 연차 대장 열람만(디렉터 9/11).
export default function MyLeaveLedgerPage() {
  return <LeaveLedgerView backHref="/leave" backLabel="휴가 관리로" />;
}
