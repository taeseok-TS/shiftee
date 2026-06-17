import { redirect } from "next/navigation";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { AdminSidebar } from "@/components/layout/AdminSidebar";
import { RoleSwitch } from "@/components/layout/RoleSwitch";
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
      <AdminSidebar isSuperAdmin={superAdmin} />
      <main className="flex-1 overflow-auto">
        <div className="flex justify-between items-center px-8 py-4 bg-white border-b border-gray-200">
          <h1 className="text-xl font-semibold text-gray-800">관리자 대시보드</h1>
          <RoleSwitch />
        </div>
        <div className="p-8">{children}</div>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
