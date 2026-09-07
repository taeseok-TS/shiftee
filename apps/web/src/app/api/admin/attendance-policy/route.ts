import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { readClockOutLimit, saveClockOutLimit, parseHhmm } from "@/lib/attendance-policy";

// 출퇴근 정책 조회 (관리자)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  return NextResponse.json({ clockOutLimit: await readClockOutLimit() });
}

// 출퇴근 정책 변경 (관리자)
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 변경할 수 있습니다." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { enabled?: unknown; time?: unknown };
  if (typeof body.enabled !== "boolean")
    return NextResponse.json({ error: "사용 여부 값이 필요합니다." }, { status: 400 });
  if (parseHhmm(body.time) == null)
    return NextResponse.json({ error: "시각은 HH:mm 형식이어야 합니다. (예: 23:59)" }, { status: 400 });

  const next = { enabled: body.enabled, time: (body.time as string).trim() };
  const before = await readClockOutLimit();
  await saveClockOutLimit(next);
  // 근태는 급여 근거다 — 정책 변경은 누가 언제 했는지 남긴다.
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "ATTENDANCE_POLICY_UPDATE",
    targetType: "AppSetting", targetId: "attendance.clockOutLimit", targetName: "퇴근 가능 시간",
    detail: `${before.enabled ? before.time : "제한없음"} → ${next.enabled ? next.time : "제한없음"}`,
  }).catch(() => {});
  return NextResponse.json({ success: true, clockOutLimit: next });
}
