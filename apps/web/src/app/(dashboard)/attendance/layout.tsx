import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { isAllowed } from "@/lib/permission-settings";

// 출퇴근(기록 조회)은 관리자·원장. 직원은 본부가 「본인 출퇴근 기록 열람(웹)」을 켠 경우에만(권한 설정 #39, 기본 끔 = 앱으로만 출퇴근).
export default async function AttendanceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role === "EMPLOYEE" && !(await isAllowed("employee.viewOwnAttendance"))) redirect("/dashboard");
  return <>{children}</>;
}
