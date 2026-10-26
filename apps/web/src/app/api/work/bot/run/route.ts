import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { runAllBriefingsNow, runNoticeReminders, botSendDM } from "@/lib/bot";

// 봇 작업 수동 실행 (최고 관리자 전용 — 테스트/즉시 발송용. 2026-10-23 검증 J: 서브 관리자가 전 직원 브리핑을 쏠 수 있었다)
// POST { job: "briefing" | "reminders" }
//      { job: "dm", userIds: string[], text: string } — 큐브티 봇이 고른 직원에게 1:1 DM(+푸시). 본문의 {이름} 은 받는 사람 이름으로 바뀐다.
//        2026-10-26 보안 점검: 흔한 비밀번호 7명에게 변경 안내를 보내려는데 봇 DM 을 사람이 골라 보내는 길이 없었다. 감사 로그에 남는다.
const DM_MAX_USERS = 50;
const DM_MAX_TEXT = 2000;
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" || !(await isSuperAdmin(session.userId)))
    return NextResponse.json({ error: "최고 관리자만 실행할 수 있습니다." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { job?: string; userIds?: unknown; text?: unknown };
  const { job } = body;
  if (job === "dm") {
    const userIds = Array.isArray(body.userIds) ? body.userIds.filter((v): v is string => typeof v === "string" && v.length > 0) : [];
    const text = typeof body.text === "string" ? body.text.replace(/\r\n/g, "\n").trim() : "";
    if (!userIds.length || userIds.length > DM_MAX_USERS)
      return NextResponse.json({ error: `userIds 는 1~${DM_MAX_USERS}명이어야 합니다.` }, { status: 400 });
    if (!text || text.length > DM_MAX_TEXT)
      return NextResponse.json({ error: `text 는 1~${DM_MAX_TEXT}자여야 합니다.` }, { status: 400 });
    const uniq = Array.from(new Set(userIds));
    // isActive 로 퇴사자·봇 계정(isActive:false)을 뺀다 — 봇 자신을 넣으면 sendDMAs 가 엉뚱한 직원 방을 잡는다(검증)
    const users = await prisma.user.findMany({
      where: { id: { in: uniq }, deletedAt: null, isActive: true },
      select: { id: true, name: true },
    });
    const sent: string[] = [];
    const failed: string[] = [];
    for (const u of users) {
      const ok = await botSendDM(u.id, text.replace(/\{이름\}/g, () => u.name));
      (ok ? sent : failed).push(u.name);
    }
    const missing = uniq.length - users.length; // 없거나 비활성인 계정 수
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "BOT_DM_SEND",
      targetType: "User", targetId: users.map((u) => u.id).join(","), targetName: sent.join(", "),
      detail: `봇 DM 수동 발송 ${sent.length}명${failed.length ? ` · 실패 ${failed.join(", ")}` : ""}${missing ? ` · 없거나 비활성 ${missing}` : ""}: ${text.slice(0, 200)}`,
    });
    return NextResponse.json({ success: true, sent, failed, missing });
  }
  if (job === "briefing") {
    const results = await runAllBriefingsNow();
    return NextResponse.json({ success: true, results, note: "sent=게시됨, empty=오늘 알릴 내용 없음, skipped=비활성" });
  }
  if (job === "reminders") {
    await runNoticeReminders();
    return NextResponse.json({ success: true, note: "중요 공지 재알림 실행됨 (미확인자에게 푸시)" });
  }
  return NextResponse.json({ error: "job은 briefing · reminders · dm 중 하나여야 합니다." }, { status: 400 });
}
