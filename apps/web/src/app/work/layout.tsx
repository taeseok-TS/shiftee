import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { WorkSidebar } from "@/components/layout/WorkSidebar";
import { Toaster } from "@/components/ui/sonner";

export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen bg-gray-100">
      <WorkSidebar />
      <main className="flex-1 overflow-auto">{children}</main>
      <Toaster richColors position="top-right" />
    </div>
  );
}
