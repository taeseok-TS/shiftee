import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 결재 알림 강제발송 정책 조회 (관리자)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const force = await prisma.appSetting.findUnique({ where: { key: "forceApprovalNotify" } });

  // 시스템 알림 수신자 (2026-09-03) — 관리자 전원이 아니라 담당자만 받게 고를 수 있다.
  const { readNotifyTargets } = await import("@/lib/notify-targets");
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  const systemTargets = await readNotifyTargets("system");

  return NextResponse.json({
    forceApprovalNotify: force?.value === "true",
    admins,
    systemTargets, // null = 미지정(= 관리자 전원)
  });
}

// 결재 알림 강제발송 정책 변경 (관리자)
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    forceApprovalNotify?: boolean;
    systemTargets?: string[];
  };

  // 시스템 알림 수신자만 바꾸는 요청
  if (Array.isArray(body.systemTargets)) {
    const { saveNotifyTargets } = await import("@/lib/notify-targets");
    const ids = body.systemTargets.filter((x) => typeof x === "string");
    // 실제 활성 관리자만 저장한다 — 퇴사자 id 가 남아 아무에게도 안 가는 일을 막는다
    const valid = await prisma.user.findMany({
      where: { id: { in: ids }, role: "ADMIN", isActive: true },
      select: { id: true },
    });
    const ids2 = valid.map((v) => v.id);
    await saveNotifyTargets("system", ids2);
    // 다른 관리자 변경(지점.직원.공휴일 등)은 전부 이력을 남기는데 여기만 빠져 있었다.
    // 관리자 누구나 시스템 알림을 자기만 받게 바꿀 수 있으므로 흔적이 남아야 한다.
    const names = await prisma.user.findMany({ where: { id: { in: ids2 } }, select: { name: true } });
    const { logAudit } = await import("@/lib/audit");
    await logAudit({
      actorId: session.userId,
      actorName: session.name || session.email || session.userId,
      action: "시스템 알림 수신자 변경",
      targetType: "AppSetting",
      targetId: "notifyTargets.system",
      detail: ids2.length ? names.map((n) => n.name).join(", ") : "(비움 - 관리자 전원 수신)",
    });
    return NextResponse.json({ success: true, systemTargets: ids2 });
  }

  const { forceApprovalNotify } = body;
  if (typeof forceApprovalNotify !== "boolean")
    return NextResponse.json({ error: "forceApprovalNotify 값이 필요합니다." }, { status: 400 });

  await prisma.appSetting.upsert({
    where: { key: "forceApprovalNotify" },
    create: { key: "forceApprovalNotify", value: String(forceApprovalNotify) },
    update: { value: String(forceApprovalNotify) },
  });
  return NextResponse.json({ success: true, forceApprovalNotify });
}
