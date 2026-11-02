import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isContractViewer } from "@/lib/contract-viewer";
import { Toaster } from "@/components/ui/sonner";
import { FinanceLogout } from "./FinanceLogout";

// 재무팀 전자계약 열람 전용 계정의 화면 틀(2026-11-02 디렉터 회의 5번, lib/contract-viewer) — 메뉴 없이 계약서 목록 하나
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!(await isContractViewer(session))) redirect("/dashboard");
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white border-b">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <p className="font-bold text-indigo-700">CUBETEE <span className="text-gray-500 font-medium text-sm">전자계약 열람</span></p>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">{session.name}</span>
            <FinanceLogout />
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
