// 관리자 결재함 › 처리한 요청(2026-10-20 시안 v2 8번) — 직원 쪽 「내 요청」과 같은 화면(RequestsView)을 결재함 머리 아래에 연다.
// 결재함 알약 탭 한 줄(시안 R11)이 위에 있어 「내 요청」 제목만 뺀다(embedded) — 「내가 올린 요청/내가 처리한 것」 토글은 그대로, 처음엔 「내가 처리한 것」.
import ApprovalsHeader from "@/components/approvals/ApprovalsHeader";
import RequestsView from "@/components/requests/RequestsView";

export default function AdminRequestsPage() {
  return (
    <div>
      <ApprovalsHeader active="decided" />
      <RequestsView initialWho="decided" embedded />
    </div>
  );
}
