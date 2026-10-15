import { redirect } from "next/navigation";
import { GitBranch } from "lucide-react";
import { getSession } from "@/lib/auth";
import ApprovalRulesEditor from "@/components/admin/ApprovalRulesEditor";
import DelegateManager from "@/components/leave/DelegateManager";

// 결재 규칙(2026-10-15 QA76 #16, 희망화면 4) — 요청 종류별 결재선 · 예외 결재선(직원·지점) · 원장대행을 한 화면에서. 관리자만
export const dynamic = "force-dynamic";

export default async function ApprovalRulesPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");
  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><GitBranch size={22} />결재 규칙</h1>
        <p className="text-sm text-gray-500 mt-1">휴가·근무일정·출퇴근 요청을 누가 어떤 차례로 결재할지 정합니다. 바꾼 내용은 설정 › 변경 로그에 남습니다.</p>
      </div>
      <ApprovalRulesEditor />
      <div>
        <h2 className="text-base font-semibold text-gray-900 mb-2">원장대행 지정</h2>
        <DelegateManager />
      </div>
    </div>
  );
}
