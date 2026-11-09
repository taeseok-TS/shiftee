import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";

// 관리자(서브 포함) 화면 — 확인 대기 · 정보 변경을 서브 관리자도 보고 처리한다(2026-11-09 디렉터, 처리자는 기록에 남는다).
// 연결 정보 · 자동 반영 켜고 끄기는 여전히 메인 관리자만(API 에서 막는다). 예전에는 메인 관리자 전용(2026-10-23 ■0-3 · ■3)
export default async function AdminOnlyLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") redirect("/admin/dashboard");
  return <>{children}</>;
}
