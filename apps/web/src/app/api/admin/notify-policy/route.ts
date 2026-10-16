import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hiddenIdsFor } from "@/lib/hidden-accounts";

// 결재 알림 강제발송 정책 조회 (관리자)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const force = await prisma.appSetting.findUnique({ where: { key: "forceApprovalNotify" } });

  // 시스템 알림 수신자 (2026-09-03) — 관리자 전원이 아니라 담당자만 받게 고를 수 있다.
  const { readNotifyTargets } = await import("@/lib/notify-targets");
  // 개발자 영역(메인 관리자)은 체크박스 목록에서 뺀다(보는 사람만 본다 — 2026-10-17 디렉터).
  // 보이는 목록만이다 — 실제로 보내는 대상(lib/notify-targets getNotifyRecipients)은 그대로라 알림은 계속 받는다
  const hidden = await hiddenIdsFor(session);
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true, ...(hidden.length ? { id: { notIn: hidden } } : {}) },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  const rawTargets = await readNotifyTargets("system");
  const systemTargets = rawTargets ? rawTargets.filter((id) => !hidden.includes(id)) : null;
  // 화면에 안 보이는 수신자가 지정에 들어 있다 — 보이는 목록이 비어도 「전원」이 아니다(화면이 문구를 바꾼다)
  const hiddenTargets = !!rawTargets?.some((id) => hidden.includes(id));

  return NextResponse.json({
    forceApprovalNotify: force?.value === "true",
    admins,
    systemTargets, // null = 미지정(= 관리자 전원)
    hiddenTargets,
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
    const { saveNotifyTargets, readNotifyTargets } = await import("@/lib/notify-targets");
    let ids = body.systemTargets.filter((x) => typeof x === "string");
    // 숨김 계정이 안 보이는 관리자가 저장해도 **숨김 계정의 수신은 그대로 둔다** — 화면에 없어서 체크를 못 했을 뿐이다(2026-10-17).
    //  · 종전 지정에 숨김 계정이 있었으면 → 보이는 사람을 다 꺼도 숨김 계정은 남긴다(비워 「전원」으로 넓어지지 않게)
    //  · 종전이 미지정(= 관리자 전원 수신)이었으면 → 누군가 고르면 숨김 계정도 이어서 넣고, 아무도 안 고르면 그대로 미지정
    const hidden = await hiddenIdsFor(session);
    if (hidden.length) {
      const prev = await readNotifyTargets("system");
      const visible = ids.filter((id) => !hidden.includes(id));
      const keep = !prev || prev.length === 0 ? (visible.length ? hidden : []) : hidden.filter((id) => prev.includes(id));
      ids = [...visible, ...keep];
    }
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
      action: "NOTIFY_TARGETS_UPDATE",   // 이름표는 lib/audit-labels.ts(2026-10-14 전엔 한글 문장이 코드 자리에 있었다)
      targetType: "AppSetting",
      targetId: "notifyTargets.system",
      detail: ids2.length ? names.map((n) => n.name).join(", ") : "(비움 - 관리자 전원 수신)",
    });
    return NextResponse.json({ success: true, systemTargets: ids2.filter((id) => !hidden.includes(id)), hiddenTargets: ids2.some((id) => hidden.includes(id)) });
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
