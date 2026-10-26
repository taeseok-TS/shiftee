import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin, type JWTPayload } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { hiddenIdsFor } from "@/lib/hidden-accounts";
import { NOTIFY_TOPICS, NOTIFY_TOPIC_KEYS, activeAdminWhere, isNotifyTopic, notifyTopicList, readAllNotifyTargets, readNotifyTargets, saveNotifyTargets, type NotifyTopic } from "@/lib/notify-targets";

type Session = JWTPayload;

// 결재 알림 강제발송 정책 + 봇 알림 종류별 수신자 조회 (최고 관리자)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" || !(await isSuperAdmin(session.userId))) return NextResponse.json({ error: "최고 관리자만 접근할 수 있습니다." }, { status: 403 });

  const force = await prisma.appSetting.findUnique({ where: { key: "forceApprovalNotify" } });

  // 알림 수신자 (2026-09-03 시스템 알림 → 2026-10-26 종류별) — 관리자 전원이 아니라 담당자만 받게 고를 수 있다.
  // 개발자 영역(메인 관리자)은 체크박스 목록에서 뺀다(보는 사람만 본다 — 2026-10-17 디렉터).
  // 보이는 목록만이다 — 실제로 보내는 대상(lib/notify-targets getNotifyRecipients)은 그대로라 알림은 계속 받는다
  const hidden = await hiddenIdsFor(session);
  const admins = await prisma.user.findMany({
    where: { ...activeAdminWhere(), ...(hidden.length ? { id: { notIn: hidden } } : {}) },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  const raw = await readAllNotifyTargets();
  const targets = {} as Record<NotifyTopic, string[] | null>;
  const hiddenTopics = {} as Record<NotifyTopic, boolean>;
  for (const t of NOTIFY_TOPIC_KEYS) {
    // 저장값이 「빈 목록」이고 숨은 수신자도 없으면 미지정(null)과 같은 뜻 — 화면이 체크 전부 해제로 보이지 않게(10/26 검증)
    const vis = raw[t] ? raw[t]!.filter((id) => !hidden.includes(id)) : null;
    targets[t] = vis && (vis.length || raw[t]!.some((id) => hidden.includes(id))) ? vis : null;
    // 화면에 안 보이는 수신자가 지정에 들어 있다 — 보이는 목록이 비어도 「전원」이 아니다(화면이 문구를 바꾼다)
    hiddenTopics[t] = !!raw[t]?.some((id) => hidden.includes(id));
  }

  return NextResponse.json({
    forceApprovalNotify: force?.value === "true",
    admins,
    topics: notifyTopicList(),
    targets,          // 종류별 수신자. null = 미지정(= 관리자 전원)
    hiddenTopics,     // 종류별 「표시 안 되는 수신자 있음」
    // 호환 — 종전 화면·호출부가 쓰던 꼴(시스템 알림 하나)
    systemTargets: targets.system,
    hiddenTargets: hiddenTopics.system,
  });
}

/**
 * 한 종류의 수신자 저장 — 숨김 계정 유지 · 활성 관리자만 · 감사 기록. 종전 systemTargets 로직을 종류별로 그대로 쓴다.
 * 돌려주는 값은 화면용(숨김 계정 뺀 목록 + 숨김 수신자 유무).
 */
async function applyTargets(session: Session, topic: NotifyTopic, input: string[], hidden: string[]) {
  let ids = input.filter((x) => typeof x === "string");
  // 숨김 계정이 안 보이는 관리자가 저장해도 **숨김 계정의 수신은 그대로 둔다** — 화면에 없어서 체크를 못 했을 뿐이다(2026-10-17).
  //  · 종전 지정에 숨김 계정이 있었으면 → 보이는 사람을 다 꺼도 숨김 계정은 남긴다(비워 「전원」으로 넓어지지 않게)
  //  · 종전이 미지정(= 관리자 전원 수신)이었으면 → 누군가 고르면 숨김 계정도 이어서 넣고, 아무도 안 고르면 그대로 미지정
  if (hidden.length) {
    const prev = await readNotifyTargets(topic);
    const visible = ids.filter((id) => !hidden.includes(id));
    const keep = !prev || prev.length === 0 ? (visible.length ? hidden : []) : hidden.filter((id) => prev.includes(id));
    ids = [...visible, ...keep];
  }
  // 실제 활성 관리자만 저장한다 — 퇴사자 id 가 남아 아무에게도 안 가는 일을 막는다
  const valid = await prisma.user.findMany({
    where: { id: { in: ids }, ...activeAdminWhere() },
    select: { id: true },
  });
  const ids2 = valid.map((v) => v.id);
  await saveNotifyTargets(topic, ids2);
  // 다른 관리자 변경(지점.직원.공휴일 등)은 전부 이력을 남기는데 여기만 빠져 있었다.
  // 관리자 누구나 알림을 자기만 받게 바꿀 수 있으므로 흔적이 남아야 한다 — 종류별로 「바뀐 사람」을 남긴다.
  const names = await prisma.user.findMany({ where: { id: { in: ids2 } }, select: { name: true } });
  const { logAudit } = await import("@/lib/audit");
  await logAudit({
    actorId: session.userId,
    actorName: session.name || session.email || session.userId,
    action: "NOTIFY_TARGETS_UPDATE",   // 이름표는 lib/audit-labels.ts(2026-10-14 전엔 한글 문장이 코드 자리에 있었다)
    targetType: "AppSetting",
    targetId: `notifyTargets.${topic}`,
    targetName: NOTIFY_TOPICS[topic].label,
    detail: `${NOTIFY_TOPICS[topic].label}: ${ids2.length ? names.map((n) => n.name).join(", ") : "(비움 - 관리자 전원 수신)"}`,
  });
  return { visible: ids2.filter((id) => !hidden.includes(id)), hiddenAny: ids2.some((id) => hidden.includes(id)) };
}

// 결재 알림 강제발송 정책 · 봇 알림 수신자 변경 (최고 관리자)
export async function PATCH(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" || !(await isSuperAdmin(session.userId))) return NextResponse.json({ error: "최고 관리자만 접근할 수 있습니다." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    forceApprovalNotify?: boolean;
    systemTargets?: string[];
    targets?: Record<string, unknown>;
  };

  // 종류별 수신자 변경 — { targets: { [종류]: id[] } } (2026-10-26). 모르는 종류·배열 아닌 값은 400.
  if (body.targets && typeof body.targets === "object") {
    const entries = Object.entries(body.targets);
    if (!entries.length) return NextResponse.json({ error: "바꿀 알림 종류가 없습니다." }, { status: 400 });
    for (const [k, v] of entries) {
      if (!isNotifyTopic(k)) return NextResponse.json({ error: `알 수 없는 알림 종류입니다: ${k}` }, { status: 400 });
      if (!Array.isArray(v)) return NextResponse.json({ error: `${NOTIFY_TOPICS[k].label} 수신자는 목록이어야 합니다.` }, { status: 400 });
    }
    const hidden = await hiddenIdsFor(session);
    const targets: Partial<Record<NotifyTopic, string[]>> = {};
    const hiddenTopics: Partial<Record<NotifyTopic, boolean>> = {};
    for (const [k, v] of entries) {
      const topic = k as NotifyTopic;
      const r = await applyTargets(session, topic, v as string[], hidden);
      targets[topic] = r.visible;
      hiddenTopics[topic] = r.hiddenAny;
    }
    return NextResponse.json({ success: true, targets, hiddenTopics });
  }

  // 시스템 알림 수신자만 바꾸는 요청 (호환 — 종전 화면 꼴)
  if (Array.isArray(body.systemTargets)) {
    const hidden = await hiddenIdsFor(session);
    const r = await applyTargets(session, "system", body.systemTargets, hidden);
    return NextResponse.json({ success: true, systemTargets: r.visible, hiddenTargets: r.hiddenAny });
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
