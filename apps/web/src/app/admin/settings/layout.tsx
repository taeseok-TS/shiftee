import { redirect } from "next/navigation";
import { getSession, isSuperAdmin } from "@/lib/auth";

// 시스템 설정·백업 = 메인(최고) 관리자 전용
export default async function AdminSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN" || !(await isSuperAdmin(session.userId))) {
    redirect("/admin/dashboard");
  }
  return <>{children}</>;
}
