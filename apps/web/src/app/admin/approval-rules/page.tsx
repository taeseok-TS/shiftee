import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PageHead } from "@/components/kit";
import ApprovalRulesEditor from "@/components/admin/ApprovalRulesEditor";
import DelegateManager from "@/components/leave/DelegateManager";

// 결재 규칙(2026-10-15 QA76 #16, 희망화면 4) — 요청 종류별 결재선 · 예외 결재선(직원·지점) · 원장대행을 한 화면에서. 관리자만
// 머리는 kit PageHead(서버 컴포넌트에서 클라이언트 부품을 그리는 것뿐이라 그대로 쓴다). 긴 설명은 Editor 안 「규칙 읽는 법」에 접어 둔다(2026-10-23 ■3)
export const dynamic = "force-dynamic";

export default async function ApprovalRulesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");
  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <PageHead crumb="결재 › 결재 규칙" title="결재 규칙" />
      <ApprovalRulesEditor />
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-2">원장대행 지정</h2>
        <DelegateManager />
      </div>
    </div>
  );
}
