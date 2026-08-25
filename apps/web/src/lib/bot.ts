import { prisma } from "@/lib/db";
import { emitWork } from "@/lib/work-events";
import { sendPushToUsers } from "@/lib/push";

/**
 * 큐브티 봇 — 자동 알림 (아침 브리핑, 결재 결과 DM, 중요 공지 재알림)
 * 봇 계정은 isActive=false 라 로그인/직원목록/채팅대상 목록에 노출되지 않고
 * 메시지 발신자(FK)로만 쓰인다.
 */

const BOT_ID = "cubetee-bot";
const KST_MS = 9 * 60 * 60 * 1000;

const LEAVE_LABEL: Record<string, string> = {
  ANNUAL: "연차", HALF_AM: "오전반차", HALF_PM: "오후반차",
  QUARTER_AM: "오전반반차", QUARTER_PM: "오후반반차",
  SICK: "병가", PERSONAL: "개인휴가", SPECIAL: "특별휴가",
  COMPENSATORY: "대체휴무", COMPENSATORY_HALF: "대체휴무반차",
  CIVIL_DEFENSE: "민방위", RESERVE_FORCES: "예비군훈련",
  MATERNITY: "출산휴가", BEREAVEMENT: "경조사",
  FAMILY_EVENT: "경조사", FAMILY_MARRIAGE: "결혼", FAMILY_BIRTH: "출산", FAMILY_BEREAVEMENT: "사망(조사)",
};

export async function ensureBot(): Promise<string> {
  // upsert — 동시 호출 시 find→create 레이스로 PK 충돌 나지 않게
  await prisma.user.upsert({
    where: { id: BOT_ID },
    update: {},
    create: { id: BOT_ID, email: "bot@cubetee.co.kr", password: "LOCKED", name: "큐브티 봇", role: "EMPLOYEE", isActive: false },
  });
  return BOT_ID;
}

// 봇 → 사용자 1:1 DM (+ 푸시)
export async function botSendDM(userId: string, content: string, opts?: { respectWorkMute?: boolean }) {
  try {
    const botId = await ensureBot();
    let dm = await prisma.workChannel.findFirst({
      where: {
        type: "DM",
        AND: [
          { members: { some: { userId: botId } } },
          { members: { some: { userId } } },
        ],
      },
      select: { id: true, deletedAt: true },
    });
    if (!dm) {
      dm = await prisma.workChannel.create({
        data: {
          name: "DM",
          type: "DM",
          createdBy: botId,
          members: { create: [{ userId: botId }, { userId }] },
        },
        select: { id: true, deletedAt: true },
      });
    } else if (dm.deletedAt) {
      await prisma.workChannel.update({ where: { id: dm.id }, data: { deletedAt: null, permanentlyDeletedAt: null } });
    }
    await prisma.workMessage.create({ data: { channelId: dm.id, userId: botId, content } });
    emitWork({ type: "message", channelId: dm.id });
    await sendPushToUsers([userId], {
      title: "큐브티 봇",
      body: content.length > 120 ? content.slice(0, 120) + "…" : content,
      data: { channelId: dm.id, type: "work-message" },
    }, { withWorkBadge: true, ...(opts?.respectWorkMute ? { respectWorkMute: true } : {}) });
  } catch (e) {
    console.error("[bot] DM 발송 오류:", e);
  }
}

// 결재 결과 DM (휴가/근무일정 공용)
// 발송 조건: 관리자 강제발송(forceApprovalNotify)이 켜져 있으면 항상,
// 꺼져 있으면 직원 본인의 수신 설정(notifyApproval)을 따른다.
export async function botNotifyDecision(
  requesterId: string,
  kind: string, // 예: "연차 (2026-07-10 ~ 2026-07-10)"
  approved: boolean,
  approverName: string,
  reason?: string | null
) {
  try {
    const force = await prisma.appSetting.findUnique({ where: { key: "forceApprovalNotify" } });
    if (force?.value !== "true") {
      const user = await prisma.user.findUnique({ where: { id: requesterId }, select: { notifyApproval: true } });
      if (user && !user.notifyApproval) return; // 본인이 꺼둠 → 발송 안 함
    }
  } catch (e) {
    console.error("[bot] 결재알림 설정 조회 오류(발송 계속):", e);
  }
  const text = approved
    ? `✅ ${kind} 결재가 승인되었습니다. (결재: ${approverName})`
    : `❌ ${kind} 결재가 반려되었습니다. (결재: ${approverName})${reason ? `\n사유: ${reason}` : ""}`;
  await botSendDM(requesterId, text);
}

function kstNow(): Date {
  return new Date(Date.now() + KST_MS);
}

// KST 오늘의 UTC 시각 범위
function kstTodayRange() {
  const k = kstNow();
  const start = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - KST_MS);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1) };
}

type BriefingConfig = {
  id: string;
  name: string;
  channelId: string | null;
  branch: string | null;
  showLeaves: boolean;
  showEvents: boolean;
  showAnniv: boolean;
  showBirthday: boolean;
  customText: string | null;
  attachments: unknown;
};

// 파일명에서 월(1~12) 추출 — "3월 카드뉴스", "03_카드뉴스", "2026-03" 등. 못 읽으면 null
export function monthFromFileName(name: string): number | null {
  const kr = name.match(/(\d{1,2})\s*월/); // "3월", "03 월"
  if (kr) {
    const n = parseInt(kr[1]);
    if (n >= 1 && n <= 12) return n;
  }
  const ym = name.match(/^20\d{2}[-_.년\s]+(\d{1,2})(?!\d)/); // "2026-03", "2026년 3"
  if (ym) {
    const n = parseInt(ym[1]);
    if (n >= 1 && n <= 12) return n;
  }
  const lead = name.match(/^(\d{1,2})(?!\d)/); // "03_카드뉴스.jpg", "3.카드뉴스"
  if (lead) {
    const n = parseInt(lead[1]);
    if (n >= 1 && n <= 12) return n;
  }
  return null;
}

// 설정 기반 브리핑 본문 생성 (선택된 항목만, branch 지정 시 해당 지점 구성원만. 알릴 게 없으면 null)
async function buildBriefingContent(cfg: BriefingConfig): Promise<string | null> {
  const k = kstNow();
  const { start, end } = kstTodayRange();
  // 오늘 날짜 (@db.Date 컬럼과 동일한 UTC 자정 규칙)
  const todayDate = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));
  const branchUserWhere = cfg.branch ? { branch: cfg.branch } : {};

  const [leaves, events, users] = await Promise.all([
    cfg.showLeaves
      ? prisma.leaveRequest.findMany({
          where: {
            status: "APPROVED",
            startDate: { lte: todayDate },
            endDate: { gte: todayDate },
            user: { isActive: true, ...branchUserWhere },
          },
          include: { user: { select: { name: true, branch: true } } },
        })
      : Promise.resolve([]),
    cfg.showEvents
      ? prisma.workCalendarEvent.findMany({
          where: {
            startDate: { lte: end },
            endDate: { gte: start },
            managersOnly: false, // 원장 전용 일정은 채널 브리핑에서 제외 (혼합 구성원 노출 방지)
            // 지점 브리핑: 전사 일정 + 해당 지점 일정만
            ...(cfg.branch ? { OR: [{ branch: null }, { branch: cfg.branch }] } : {}),
          },
          orderBy: { startDate: "asc" },
        })
      : Promise.resolve([]),
    cfg.showAnniv || cfg.showBirthday
      ? prisma.user.findMany({
          where: { isActive: true, ...branchUserWhere },
          select: { name: true, branch: true, hireDate: true, birthDate: true },
        })
      : Promise.resolve([]),
  ]);

  const tag = (name: string, branch: string | null) => `${name}${!cfg.branch && branch ? `(${branch})` : ""}`;
  const isTodayKst = (d: Date) => {
    const t = new Date(d.getTime() + KST_MS);
    return t.getUTCMonth() === k.getUTCMonth() && t.getUTCDate() === k.getUTCDate();
  };

  const leaveLines = leaves.map((l) => `· ${tag(l.user.name, l.user.branch)} — ${LEAVE_LABEL[l.type] || l.type}`);
  const eventLines = events.map((e) => `· ${e.title}${e.branch ? ` [${e.branch}]` : ""}`);
  const annivLines = cfg.showAnniv
    ? (users
        .map((u) => {
          if (!u.hireDate || !isTodayKst(u.hireDate)) return null;
          const years = k.getUTCFullYear() - new Date(u.hireDate.getTime() + KST_MS).getUTCFullYear();
          return years >= 1 ? `· ${tag(u.name, u.branch)} — 입사 ${years}주년 🎉` : null;
        })
        .filter(Boolean) as string[])
    : [];
  const birthdayLines = cfg.showBirthday
    ? (users
        .map((u) => (u.birthDate && isTodayKst(u.birthDate) ? `· ${tag(u.name, u.branch)} 🎂` : null))
        .filter(Boolean) as string[])
    : [];

  const custom = cfg.customText?.trim();
  const hasAttachments = Array.isArray(cfg.attachments) && (cfg.attachments as unknown[]).length > 0;
  if (!leaveLines.length && !eventLines.length && !annivLines.length && !birthdayLines.length && !custom && !hasAttachments)
    return null;

  const parts = [`📋 ${cfg.name} (${k.getUTCMonth() + 1}/${k.getUTCDate()})`];
  if (leaveLines.length) parts.push(`\n🌴 오늘 휴가\n${leaveLines.join("\n")}`);
  if (eventLines.length) parts.push(`\n📅 오늘 일정\n${eventLines.join("\n")}`);
  if (annivLines.length) parts.push(`\n🎊 입사기념일\n${annivLines.join("\n")}`);
  if (birthdayLines.length) parts.push(`\n🎂 오늘 생일\n${birthdayLines.join("\n")}`);
  if (custom) parts.push(`\n📢 ${custom}`);
  return parts.join("\n");
}

// 반복 조건이 오늘(KST)과 일치하는지
export function repeatMatchesToday(repeat: string, repeatValue: string | null, k: Date): boolean {
  if (repeat === "WEEKLY") {
    const days = (repeatValue || "").split(",").map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
    return days.includes(k.getUTCDay());
  }
  if (repeat === "MONTHLY") {
    const day = parseInt(repeatValue || "");
    if (isNaN(day)) return false;
    const lastDay = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth() + 1, 0)).getUTCDate();
    // 말일 보정: 31일 설정인데 이달이 30일까지면 말일에 발송
    return k.getUTCDate() === Math.min(day, lastDay);
  }
  if (repeat === "YEARLY") {
    const m = (repeatValue || "").match(/^(\d{2})-(\d{2})$/);
    if (!m) return false;
    return k.getUTCMonth() + 1 === parseInt(m[1]) && k.getUTCDate() === parseInt(m[2]);
  }
  return true; // DAILY
}

// 브리핑 1건 발송 (전체 채널). force=수동 실행(같은 날 중복 방지 무시)
export async function runBriefing(cfgId: string, force = false): Promise<"sent" | "skipped" | "empty"> {
  const cfg = await prisma.botBriefing.findUnique({ where: { id: cfgId } });
  if (!cfg || !cfg.enabled) return "skipped";

  // 멱등: 오늘 이미 보냈으면 스킵 (수동 실행은 예외)
  if (!force && cfg.lastSentAt) {
    const last = new Date(cfg.lastSentAt.getTime() + KST_MS);
    const k = kstNow();
    if (last.getUTCFullYear() === k.getUTCFullYear() && last.getUTCMonth() === k.getUTCMonth() && last.getUTCDate() === k.getUTCDate())
      return "skipped";
  }

  // 첨부 목록 확정 — 월별 자동 매칭이 켜져 있으면 파일명의 월이 이번 달인 것만 (월을 못 읽는 파일은 항상 발송)
  let atts = Array.isArray(cfg.attachments) ? (cfg.attachments as { url: string; name: string; type: string }[]) : [];
  if (cfg.monthlyAttach) {
    const thisMonth = kstNow().getUTCMonth() + 1;
    atts = atts.filter((a) => {
      const m = monthFromFileName(a?.name || "");
      return m === null || m === thisMonth;
    });
  }

  const content = await buildBriefingContent({ ...cfg, attachments: atts });
  await prisma.botBriefing.update({ where: { id: cfg.id }, data: { lastSentAt: new Date() } });
  if (!content) return "empty";

  // 발송 채널: 설정된 채널(삭제됐으면 스킵) 또는 기본 전체 채널
  let targetId: string | null = null;
  if (cfg.channelId) {
    const ch = await prisma.workChannel.findFirst({
      where: { id: cfg.channelId, deletedAt: null },
      select: { id: true },
    });
    targetId = ch?.id ?? null;
  } else {
    const general = await prisma.workChannel.findFirst({ where: { isDefault: true, type: "CHANNEL" }, select: { id: true } });
    targetId = general?.id ?? null;
  }
  if (!targetId) return "skipped";

  const botId = await ensureBot();
  await prisma.workMessage.create({ data: { channelId: targetId, userId: botId, content } });
  // 등록된 첨부(이미지/파일)를 이어서 발송
  for (const a of atts) {
    if (!a?.url) continue;
    await prisma.workMessage.create({
      data: { channelId: targetId, userId: botId, content: "", fileUrl: a.url, fileName: a.name || null, fileType: a.type || "file" },
    });
  }
  emitWork({ type: "message", channelId: targetId });
  return "sent";
}

// 기본 브리핑 시드 (설정이 하나도 없으면 아침 9시 기본 생성)
export async function seedDefaultBriefing() {
  const count = await prisma.botBriefing.count();
  if (count === 0) {
    await prisma.botBriefing.create({
      data: { name: "아침 브리핑", time: "09:00", enabled: true, showLeaves: true, showEvents: true, showAnniv: true },
    });
  }
}

// 모든 활성 브리핑 즉시 실행 (관리자 수동 트리거)
export async function runAllBriefingsNow(): Promise<{ name: string; result: string }[]> {
  await seedDefaultBriefing();
  const configs = await prisma.botBriefing.findMany({ where: { enabled: true } });
  const results: { name: string; result: string }[] = [];
  for (const c of configs) {
    results.push({ name: c.name, result: await runBriefing(c.id, true) });
  }
  return results;
}

// 중요 공지 재알림 — 공지 등록 후 아직 채널을 안 연 멤버에게 재푸시
export async function runNoticeReminders() {
  const channels = await prisma.workChannel.findMany({
    where: { noticeImportant: true, deletedAt: null, OR: [{ noticeContent: { not: null } }, { noticeImageUrl: { not: null } }] },
    select: {
      id: true,
      name: true,
      noticeContent: true,
      noticeAt: true,
      members: { select: { userId: true, lastReadAt: true } },
    },
  });
  for (const c of channels) {
    if (!c.noticeAt) continue;
    const unread = c.members.filter((m) => !m.lastReadAt || m.lastReadAt < c.noticeAt!).map((m) => m.userId);
    if (!unread.length) continue;
    const preview = c.noticeContent ? c.noticeContent.slice(0, 60) : "이미지 공지";
    // 중요공지 최초 푸시가 workMuteAll 차단 대상이므로 다음날 재알림도 동일 기준(비대칭 방지)
    await sendPushToUsers(unread, {
      title: c.name,
      body: `📌 확인하지 않은 중요 공지가 있습니다: ${preview}`,
      data: { channelId: c.id, type: "work-message" },
    }, { respectWorkMute: true, withWorkBadge: true }).catch(() => {});
  }
}

// 예약 전송 처리 — 도래한 예약 메시지를 작성자 명의로 게시 (+푸시)
export async function runScheduledMessages() {
  const due = await prisma.workScheduledMessage.findMany({
    where: { sentAt: null, canceledAt: null, sendAt: { lte: new Date() } },
    take: 20,
    include: {
      channel: { select: { name: true, deletedAt: true } },
      user: { select: { name: true } },
    },
  });
  for (const s of due) {
    await prisma.workScheduledMessage.update({ where: { id: s.id }, data: { sentAt: new Date() } });
    if (s.channel.deletedAt) continue; // 채널이 삭제됐으면 조용히 소멸
    await prisma.workMessage.create({ data: { channelId: s.channelId, userId: s.userId, content: s.content } });
    emitWork({ type: "message", channelId: s.channelId });
    // 푸시 (일반 메시지 규칙과 동일)
    try {
      const members = await prisma.workChannelMember.findMany({
        where: { channelId: s.channelId, userId: { not: s.userId } },
        select: { userId: true, notify: true, user: { select: { name: true } } },
      });
      const { isMentioned } = await import("@/lib/mention");
      const recipients = members
        .filter((m) => m.notify !== "MUTE")
        .filter((m) => (m.notify === "MENTION" ? isMentioned(s.content, m.user.name) : true))
        .map((m) => m.userId);
      await sendPushToUsers(recipients, {
        title: s.channel.name,
        body: `${s.user.name}: ${s.content.slice(0, 100)}`,
        data: { channelId: s.channelId, type: "work-message" },
      }, { respectWorkMute: true, withWorkBadge: true });
    } catch (e) {
      console.error("[bot] 예약전송 푸시 오류:", e);
    }
  }
}

// 메시지 리마인더 — 도래한 리마인더를 봇 DM으로 발송
export async function runReminders() {
  const due = await prisma.workReminder.findMany({
    where: { sentAt: null, remindAt: { lte: new Date() } },
    take: 30,
    include: {
      message: {
        select: {
          content: true, deletedAt: true, fileType: true, fileName: true, channelId: true,
          user: { select: { name: true } },
          channel: { select: { name: true, type: true, deletedAt: true } },
        },
      },
    },
  });
  for (const r of due) {
    await prisma.workReminder.update({ where: { id: r.id }, data: { sentAt: new Date() } });
    if (r.message.deletedAt || r.message.channel.deletedAt) continue;
    const chName = r.message.channel.type === "DM" ? "1:1 대화" : r.message.channel.name;
    const preview = r.message.content
      ? r.message.content.slice(0, 120)
      : r.message.fileType === "image" ? "🖼️ 사진" : `📎 ${r.message.fileName || "파일"}`;
    // 리마인더는 채팅 알림의 일종 — 전체 알림 끄기(workMuteAll) 사용자에겐 푸시 생략(DM 메시지는 남음)
    await botSendDM(r.userId, `⏰ 리마인더\n[${chName}] ${r.message.user.name}: ${preview}`, { respectWorkMute: true });
  }
}

// 임시 비번(12345678) 미변경 알림 — 관리자 초기화 후 24시간이 지나도 본인이 안 바꿨으면
// 바꿀 때까지 매일 1회 봇 DM(+푸시). 본인이 변경하면 passwordResetAt이 null이 되어 자동 중단.
export async function runPasswordResetReminders() {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const targets = await prisma.user.findMany({
    where: { isActive: true, passwordResetAt: { lt: cutoff } },
    select: { id: true, name: true },
  });
  for (const u of targets) {
    await botSendDM(
      u.id,
      "🔐 비밀번호를 변경해주세요\n" +
        "임시 비밀번호(12345678)를 계속 사용 중입니다. 보안을 위해 본인만 아는 비밀번호로 바꿔주세요.\n" +
        "· 앱: 더보기 > 설정 > 비밀번호 변경\n" +
        "· 웹: 환경설정 > 비밀번호 변경"
    );
  }
  if (targets.length) console.log(`[bot] 임시 비번 변경 요청 ${targets.length}명 발송`);
}

// 인프로세스 스케줄러 (instrumentation에서 기동)
// - 브리핑: BotBriefing 설정별 time(KST HH:mm)에 발송 (같은 날 중복은 lastSentAt으로 방지)
// - 중요 공지 재알림: 매일 KST 09:00 고정
export function startBotScheduler() {
  const g = globalThis as unknown as { __botTicker?: ReturnType<typeof setInterval>; __botRemLastRun?: string };
  if (g.__botTicker) return;
  g.__botTicker = setInterval(async () => {
    const k = kstNow();
    const hhmm = `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
    const today = `${k.getUTCFullYear()}-${k.getUTCMonth() + 1}-${k.getUTCDate()}`;

    try {
      const due = await prisma.botBriefing.findMany({
        where: { enabled: true, time: hhmm },
        select: { id: true, repeat: true, repeatValue: true },
      });
      for (const b of due) {
        if (!repeatMatchesToday(b.repeat, b.repeatValue, k)) continue;
        try { await runBriefing(b.id); } catch (e) { console.error("[bot] 브리핑 오류:", e); }
      }
    } catch (e) {
      console.error("[bot] 브리핑 조회 오류:", e);
    }

    if (k.getUTCHours() === 9 && k.getUTCMinutes() < 2 && g.__botRemLastRun !== today) {
      g.__botRemLastRun = today;
      try { await runNoticeReminders(); } catch (e) { console.error("[bot] 공지 재알림 오류:", e); }
      // 임시 비번(12345678) 24시간 이상 미변경자에게 변경 요청 (매일 09:00, 바꿀 때까지)
      try { await runPasswordResetReminders(); } catch (e) { console.error("[bot] 비번 변경 요청 오류:", e); }
    }

    // 예약 전송 + 메시지 리마인더 (매분)
    try { await runScheduledMessages(); } catch (e) { console.error("[bot] 예약전송 오류:", e); }
    try { await runReminders(); } catch (e) { console.error("[bot] 리마인더 오류:", e); }

    // 투표 종료 시간 도래 → 자동 마감 + 채팅 알림 (매분)
    try {
      const { runPollDeadlines } = await import("@/lib/poll-close");
      await runPollDeadlines();
    } catch (e) { console.error("[bot] 투표 마감 오류:", e); }

    // 시스템 헬스체크 (매시 정각 — 이상 시 관리자 DM, 유형별 하루 1회)
    if (k.getUTCMinutes() === 0) {
      try {
        const { runHealthCheckAndAlert } = await import("@/lib/monitor");
        await runHealthCheckAndAlert();
      } catch (e) { console.error("[bot] 헬스체크 오류:", e); }
    }

    // 대용량 영상 압축 큐 (한 번에 1건, 최저 우선순위 — 진행 중이면 다음 틱은 스킵)
    try {
      const { runVideoCompressQueue } = await import("@/lib/videoCompress");
      await runVideoCompressQueue();
    } catch (e) { console.error("[bot] 영상압축 오류:", e); }
  }, 60 * 1000);
  seedDefaultBriefing().catch(() => {});
  console.log("✅ 큐브티 봇 스케줄러 시작 (브리핑 설정 기반 + 공지 재알림 09:00)");
}
