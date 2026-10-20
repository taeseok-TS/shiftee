import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { isMissingOutRule, readMissingOutRule, saveMissingOutRule, readAutoFillHours, type MissingOutRule } from "@/lib/attendance-policy";

// 근태 규칙 — 퇴근 기록이 없는 날 처리(2026-10-20 본부 박정인 시안 v2 7번 · 디렉터 「추천대로」).
// 모든 관리자(본부)가 보고 바꾼다. 바꾸면 변경 로그(업무)에 남는다. 값의 뜻은 lib/attendance-policy.ts MISSING_OUT_RULE_KEY 참고.
export const dynamic = "force-dynamic";

const RULE_TEXT: Record<MissingOutRule, string> = {
  FIXED_2200: "22:00 퇴근 동의",
  SCHEDULE: "근무일정 퇴근 시각",
  IN_10_5: "출근 + 10.5시간",
  IN_FALLBACK: "출근 + 보정 시간",
};

async function recentChanges() {
  const rows = await prisma.auditLog.findMany({
    where: { action: "ATTENDANCE_RULE_UPDATE" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, actorName: true, detail: true, createdAt: true },
  });
  return rows;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  return NextResponse.json({
    rule: await readMissingOutRule(),
    fallbackHours: await readAutoFillHours(),
    changes: await recentChanges(),
  });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 바꿀 수 있습니다." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { rule?: unknown };
  if (!isMissingOutRule(body.rule)) return NextResponse.json({ error: "규칙 값이 올바르지 않습니다." }, { status: 400 });

  const before = await readMissingOutRule();
  if (before === body.rule) return NextResponse.json({ success: true, rule: before, changes: await recentChanges() });
  await saveMissingOutRule(body.rule);
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "ATTENDANCE_RULE_UPDATE",
    targetType: "AppSetting", targetId: "attendance.missingOutRule", targetName: "근태 규칙",
    detail: `퇴근 기록이 없는 날 처리 「${RULE_TEXT[before]}」→「${RULE_TEXT[body.rule]}」`,
  });
  return NextResponse.json({ success: true, rule: body.rule, changes: await recentChanges() });
}
