import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { canManageMarketing } from "@/lib/marketing-viewer";

export const dynamic = "force-dynamic";

// 마케팅 자료 화면이 「전체」 탭 · 발행 처리 단추를 보일지(lib/marketing-viewer) — 관리자 · 지정 계정이면 true
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  return NextResponse.json({ canManage: await canManageMarketing(session) });
}
