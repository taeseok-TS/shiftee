import { redirect } from "next/navigation";
import { PageHead } from "@/components/kit";
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
    <div className="space-y-4">
      {/* 머리(R15 — 설정 화면 모두 같은 머리) */}
      <PageHead crumb="설정 › 변경 로그" title="변경 로그" note="관리자가 바꾼 기록 · 지우거나 고칠 수 없음" />
      <AuditLogView isSuper={superAdmin} />
    </div>
  );
}
