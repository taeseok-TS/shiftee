import { redirect } from "next/navigation";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { MobileDashboardNav } from "@/components/layout/MobileDashboardNav";
import { Toaster } from "@/components/ui/sonner";
import { TopBar } from "@/components/layout/TopBar";
import { AdminTabs } from "@/components/layout/AdminTabs";
import { Suspense } from "react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    redirect("/login");
  }
  const superAdmin = await isSuperAdmin(session.userId);

  return (
    <div className="flex min-h-screen bg-gray-100">
      {/* 폰에서는 고정 사이드바(w-64)가 화면 2/3를 차지해 내용이 104px 로 찌그러진다
          (2026-09-04 검증에서 실측). 직원 화면에는 이미 있던 처리를 관리자.원장에도 넣는다. */}
      <div className="hidden md:block">
        <AdminSidebar isSuperAdmin={superAdmin} />
      </div>
      <main className="flex-1 min-w-0 overflow-auto">
        {/* 상단 바 — 모드 전환·큐브티워크·이름(로그아웃)(2026-10-20 시안 v2 9번) */}
        <TopBar mode="admin" role={session.role} name={session.name} sub={session.branch || "본부"}
          menu={<MobileDashboardNav><AdminSidebar isSuperAdmin={superAdmin} /></MobileDashboardNav>} />
        {/* 상단 바와 본문 사이를 넉넉하게(시안 v2 9번). 묶인 화면은 본문 위 탭(시안 v2 8번) */}
        <div className="px-4 pb-8 pt-6 md:px-8 md:pt-10">
          <Suspense fallback={null}><AdminTabs /></Suspense>
          {children}
        </div>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
