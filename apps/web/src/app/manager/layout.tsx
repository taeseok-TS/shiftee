import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ManagerSidebar } from "@/components/layout/ManagerSidebar";
import { MobileDashboardNav } from "@/components/layout/MobileDashboardNav";
import { Toaster } from "@/components/ui/sonner";
import { TopBar } from "@/components/layout/TopBar";

export default async function ManagerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || !["ADMIN", "MANAGER"].includes(session.role)) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* 폰에서는 고정 사이드바(w-64)가 화면 2/3를 차지해 내용이 104px 로 찌그러진다
          (2026-09-04 검증에서 실측). 직원 화면에는 이미 있던 처리를 관리자.원장에도 넣는다. */}
      <div className="hidden md:block">
        <ManagerSidebar />
      </div>
      <main className="flex-1 min-w-0 overflow-auto">
        <TopBar mode="manager" role={session.role} name={session.name} sub={session.role === "ADMIN" ? session.branch || "본부" : session.branch ? `${session.branch} 원장` : "원장"}
          menu={<MobileDashboardNav><ManagerSidebar /></MobileDashboardNav>} />
        <div className="px-4 pb-8 pt-6 md:px-8 md:pt-10">{children}</div>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
