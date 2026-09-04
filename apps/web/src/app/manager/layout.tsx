import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ManagerSidebar } from "@/components/layout/ManagerSidebar";
import { Toaster } from "@/components/ui/sonner";

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
      <ManagerSidebar role={session.role} />
      <main className="flex-1 overflow-auto">
        <div className="flex justify-between items-center px-8 py-4 bg-white border-b border-gray-200">
          <h1 className="text-xl font-semibold text-gray-800">팀 관리 대시보드</h1>
          {/* RoleSwitch 는 걷어냈다 (2026-09-04).
              이 컴포넌트는 `/api/auth/me` 응답을 잘못 읽어 **오랫동안 아무것도 안 그리고 있었고**,
              9/3 에 그 버그를 고치자 헤더에 역할 전환.로그아웃이 새로 나타났다. 그런데
              같은 기능이 이미 사이드바에 있다(AdminSidebar/ManagerSidebar/SharedSidebar).
              직원 70여 명 화면에 중복 UI 와 "(테스트용)" 라벨이 갑자기 보이는 것은
              의도한 변경이 아니므로 원래 보이던 모습으로 되돌린다.
              컴포넌트 자체의 버그 수정은 남겨 둔다 — 다시 쓸 때 바로 동작한다. */}
        </div>
        <div className="p-8">{children}</div>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
