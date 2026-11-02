import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkSidebar, WorkMobileNav } from "@/components/layout/WorkSidebar";
import { Toaster } from "@/components/ui/sonner";

export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  // 재무팀 전자계약 열람 전용 계정은 계약서 화면만(2026-11-02 디렉터 회의 5번 — lib/contract-viewer)
  const { isContractViewer } = await import("@/lib/contract-viewer");
  if (await isContractViewer(session)) redirect("/finance/contracts");

  return (
    // 모바일: 상단 바 + 세로 배치 / 데스크톱: 좌측 사이드바 + 가로 배치
    <div className="flex flex-col md:flex-row min-h-[100dvh] md:min-h-screen bg-gray-100">
      <WorkMobileNav role={session.role} />
      <WorkSidebar role={session.role} />
      <main className="flex-1 overflow-auto">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
