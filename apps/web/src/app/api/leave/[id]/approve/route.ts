import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { decideLeave } from "@/lib/leave-decision";

// 휴가 결재(승인 · 반려) — 본체는 lib/leave-decision.ts(연동 키 승인 창구와 같은 규칙, 2026-11-16 옮김)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  // ⚠ 본문 없이 부르면 누구나 오류 로그를 하나씩 만들 수 있었다(2026-09-09 검증에서 실측) — 실패는 null 로
  const body = await request.json().catch(() => null);
  return decideLeave(session, id, body);
}
