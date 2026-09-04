import { redirect } from "next/navigation";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { MobileDashboardNav } from "@/components/layout/MobileDashboardNav";
import { Toaster } from "@/components/ui/sonner";

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
        <div className="flex justify-between items-center px-4 md:px-8 py-4 bg-white border-b border-gray-200">
          <div className="flex items-center gap-2 min-w-0">
            <MobileDashboardNav><AdminSidebar isSuperAdmin={superAdmin} /></MobileDashboardNav>
            <h1 className="text-xl font-semibold text-gray-800 truncate">관리자 대시보드</h1>
          </div>
          {/* RoleSwitch 는 걷어냈다 (2026-09-04).
              이 컴포넌트는 `/api/auth/me` 응답을 잘못 읽어 **오랫동안 아무것도 안 그리고 있었고**,
              9/3 에 그 버그를 고치자 헤더에 역할 전환.로그아웃이 새로 나타났다. 그런데
              같은 기능이 이미 사이드바에 있다(AdminSidebar/ManagerSidebar/SharedSidebar).
              직원 70여 명 화면에 중복 UI 와 "(테스트용)" 라벨이 갑자기 보이는 것은
              의도한 변경이 아니므로 원래 보이던 모습으로 되돌린다.
              컴포넌트 자체의 버그 수정은 남겨 둔다 — 다시 쓸 때 바로 동작한다. */}
        </div>
        <div className="p-4 md:p-8">{children}</div>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
