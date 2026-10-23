import { redirect } from "next/navigation";
import { getSession, isSuperAdmin } from "@/lib/auth";

// 메인(최고) 관리자 전용 화면(2026-10-23 본부 요청 ■0-3 · ■3) — 메뉴 · 탭에서도 최고 관리자에게만 보인다
export default async function SuperOnlyLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN" || !(await isSuperAdmin(session.userId))) redirect("/admin/dashboard");
  return <>{children}</>;
}
