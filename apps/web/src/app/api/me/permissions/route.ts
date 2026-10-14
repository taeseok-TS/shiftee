import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { permissionsForRole } from "@/lib/permission-settings";

// 내 역할에 적용된 권한 토글(QA76 #39) — 사이드바·화면이 메뉴를 숨기거나 보이는 데 쓴다.
// 실제 허용은 각 API 가 서버에서 다시 본다(이 응답은 화면 안내용).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  return NextResponse.json({ role: session.role, permissions: await permissionsForRole(session.role) });
}
