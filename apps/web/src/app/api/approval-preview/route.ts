import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { previewRequestSteps } from "@/lib/approval-rules";

// 신청 화면 결재선 미리보기(2026-10-15 #16) — 결재 규칙·예외를 반영한 「내」 결재선. 신청할 때와 같은 함수로 만든다
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const sp = request.nextUrl.searchParams;
  const kind = sp.get("kind") === "LEAVE" ? "LEAVE" : "SCHEDULE";
  const steps = await previewRequestSteps({ kind, userId: session.userId, holiday: sp.get("holiday") === "1" });
  return NextResponse.json({ steps });
}
