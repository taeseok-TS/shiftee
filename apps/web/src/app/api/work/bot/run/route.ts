import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { runAllBriefingsNow, runNoticeReminders } from "@/lib/bot";

// 봇 작업 수동 실행 (관리자 전용 — 테스트/즉시 발송용)
// POST { job: "briefing" | "reminders" }
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 실행할 수 있습니다." }, { status: 403 });

  const { job } = (await request.json().catch(() => ({}))) as { job?: string };
  if (job === "briefing") {
    const results = await runAllBriefingsNow();
    return NextResponse.json({ success: true, results, note: "sent=게시됨, empty=오늘 알릴 내용 없음, skipped=비활성" });
  }
  if (job === "reminders") {
    await runNoticeReminders();
    return NextResponse.json({ success: true, note: "중요 공지 재알림 실행됨 (미확인자에게 푸시)" });
  }
  return NextResponse.json({ error: "job은 briefing 또는 reminders 여야 합니다." }, { status: 400 });
}
