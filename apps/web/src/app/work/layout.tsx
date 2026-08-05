import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkSidebar, WorkMobileNav } from "@/components/layout/WorkSidebar";
import { Toaster } from "@/components/ui/sonner";

export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    // 모바일: 상단 바 + 세로 배치 / 데스크톱: 좌측 사이드바 + 가로 배치
    <div className="flex flex-col md:flex-row min-h-[100dvh] md:min-h-screen bg-gray-100">
      <WorkMobileNav />
      <WorkSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
