import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SharedSidebar } from "@/components/layout/SharedSidebar";
import { MobileDashboardNav } from "@/components/layout/MobileDashboardNav";
import { RoleSwitch } from "@/components/layout/RoleSwitch";
import { Toaster } from "@/components/ui/sonner";

export default async function SharedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* 폰에서는 고정 사이드바(w-64)가 화면 2/3를 차지해 내용이 찌그러진다 → 숨기고 햄버거 서랍으로 */}
      <div className="hidden md:block">
        <SharedSidebar role={session.role} />
      </div>
      <main className="flex-1 min-w-0 overflow-auto">
        <div className="flex justify-between items-center px-4 md:px-8 py-4 bg-white border-b border-gray-200">
          <div className="flex items-center gap-2 min-w-0">
            <MobileDashboardNav role={session.role} />
            <h1 className="text-xl font-semibold text-gray-800 truncate">내 대시보드</h1>
          </div>
          <RoleSwitch />
        </div>
        <div className="p-4 md:p-8">{children}</div>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
