import { redirect } from "next/navigation";
import { History } from "lucide-react";
import { getSession, isSuperAdmin } from "@/lib/auth";
import AuditLogView from "@/components/admin/AuditLogView";

// 변경 로그(QA76 #66 후속, 2026-10-14 디렉터 결정) — 관리자 전부 들어온다.
// 업무 변경 기록은 모든 관리자, 시스템·보안 기록 탭은 최고관리자에게만 보인다(서버 API 도 같은 기준으로 막는다).
export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");
  const superAdmin = await isSuperAdmin(session.userId);
  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><History size={22} />변경 로그</h1>
        <p className="text-sm text-gray-500 mt-1">관리자가 무엇을 언제 바꿨는지 남긴 기록입니다. 기록은 지우거나 고칠 수 없습니다.</p>
      </div>
      <AuditLogView isSuper={superAdmin} />
    </div>
  );
}
