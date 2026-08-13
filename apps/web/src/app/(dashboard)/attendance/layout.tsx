import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// 출퇴근(기록 조회)은 관리자·원장만. 직원은 앱으로만 출퇴근 → 웹 접근 차단.
export default async function AttendanceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "EMPLOYEE") redirect("/dashboard");
  return <>{children}</>;
}
