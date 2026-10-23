import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { PERMISSION_TOGGLES, FIXED_RULES, readPermissions } from "@/lib/permission-settings";
import PermissionsScreen from "@/components/admin/PermissionsScreen";

// 권한 설정(2026-10-14 QA76 #39) — 세 탭(2026-10-23 본부 시안 S3): 켜고 끄는 권한(원장 · 직원) · 역할별로 할 수 있는 일(보기 전용 표, 스위치 상태 반영) · 고정된 규칙.
// 표의 원천은 lib/permission-matrix.ts(라우트를 바꾸면 표도 같이 고친다). 스위치가 바꾸는 줄은 applyToggles 가 덮어쓴다.
export const dynamic = "force-dynamic";

export default async function PermissionsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/dashboard");
  const settings = await readPermissions();
  return <PermissionsScreen initial={settings} toggles={PERMISSION_TOGGLES} fixed={FIXED_RULES} />;
}
