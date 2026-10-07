import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { activeDelegateBranches } from "@/lib/approval-delegate";

export const dynamic = "force-dynamic";

// 내가 오늘 원장대행 중인 지점 — 웹 메뉴·앱 결재 탭을 보여 줄지 정하는 데 쓴다(2026-10-07)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const branches = session.role === "ADMIN" ? [] : await activeDelegateBranches(session.userId);
  return NextResponse.json({ branches });
}
