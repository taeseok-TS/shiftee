import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SharedSidebar } from "@/components/layout/SharedSidebar";
import { MobileDashboardNav } from "@/components/layout/MobileDashboardNav";
import { Toaster } from "@/components/ui/sonner";
import { TopBar } from "@/components/layout/TopBar";

export default async function SharedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) {
    redirect("/login");
  }
  // 재무팀 전자계약 열람 전용 계정은 계약서 화면만(2026-11-02 디렉터 회의 5번 — lib/contract-viewer)
  const { isContractViewer } = await import("@/lib/contract-viewer");
  if (await isContractViewer(session)) redirect("/finance/contracts");

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* 폰에서는 고정 사이드바(w-64)가 화면 2/3를 차지해 내용이 찌그러진다 → 숨기고 햄버거 서랍으로 */}
      <div className="hidden md:block">
        <SharedSidebar role={session.role} />
      </div>
      <main className="flex-1 min-w-0 overflow-auto">
        <TopBar mode="employee" role={session.role} name={session.name} sub={session.branch} title="내 대시보드"
          menu={<MobileDashboardNav role={session.role} />} />
        <div className="px-4 pb-8 pt-6 md:px-8 md:pt-10">{children}</div>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
