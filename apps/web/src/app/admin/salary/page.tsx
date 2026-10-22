import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { canViewSalary } from "@/lib/salary-access";
import SalaryScreen from "./SalaryScreen";

// 인사 › 연봉(2026-10-22 디렉터) — 「연봉 보기」 권한자만. 들어가서도 비밀번호를 한 번 더 확인해야 숫자가 보인다(SalaryScreen)
export default async function SalaryPage() {
  const session = await getSession();
  if (!(await canViewSalary(session))) redirect("/admin/dashboard");
  return <SalaryScreen />;
}
