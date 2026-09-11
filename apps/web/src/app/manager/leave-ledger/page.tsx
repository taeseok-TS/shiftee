import LeaveLedgerView from "@/components/leave/LeaveLedgerView";

// 원장 — 담당 지점 직원의 연차 대장 열람만(디렉터 9/11). 권한은 api/leave/ledger 가 판정한다.
export default function ManagerLeaveLedgerPage() {
  return <LeaveLedgerView backHref="/manager/team-employees" backLabel="팀 직원으로" />;
}
