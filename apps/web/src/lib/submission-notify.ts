// 자료제출 알림 — 봇 DM 6종 + 스케줄 잡 (2026-09-13 기획 1-5)
//
//  요청 생성 → 대상자 DM / 마감 전날 09시 미제출자 독촉 / 마감 다음날 09시 미제출자+본부 명단
//  제출 건별 알림은 하지 않는다(71명이 내면 71통) → 매일 18시 본부 요약 한 통(없으면 안 보냄)
//  공유 켜면 대상 직군 DM
// 알림 실패가 본 작업(요청 생성·제출·공유)을 되돌리면 안 되므로 호출부는 await 하지 않는다(void).
import { prisma } from "@/lib/db";
import { botSendDM } from "@/lib/bot";
import { getAppUrl } from "@/lib/app-url";
import { targetUsersFor, usersInJobGroups } from "@/lib/submission-targets";
import { dateStr, todayStrKST } from "@/lib/submissions";

// ⚠ request.url 의 origin 은 컨테이너 내부 주소 — 링크는 반드시 getAppUrl() 로
const pageUrl = () => `${getAppUrl()}/work/submissions`;

function dueText(d: Date | null): string {
  const s = dateStr(d);
  return s ? `${s} 까지` : "마감 없음";
}

async function loadRequest(id: string) {
  return prisma.submissionRequest.findUnique({ where: { id }, include: { category: true } });
}

/** 제출한 사람 id 집합 (삭제 제외) */
async function submittedUserIds(requestId: string): Promise<Set<string>> {
  const rows = await prisma.submission.findMany({ where: { requestId, deletedAt: null }, select: { userId: true } });
  return new Set(rows.map((r) => r.userId));
}

async function sendMany(userIds: string[], content: string) {
  // 순차 발송 — 한 통이 실패해도 다음 사람은 받는다(botSendDM 이 안에서 삼킨다)
  for (const id of userIds) await botSendDM(id, content, { respectWorkMute: true });
}

export async function notifyRequestCreated(requestId: string) {
  try {
    const r = await loadRequest(requestId);
    if (!r) return;
    const targets = await targetUsersFor(r);
    const msg =
      `📤 내야 할 자료가 생겼습니다\n「${r.title}」\n` +
      `분류 ${r.category.name} · ${dueText(r.dueDate)}` +
      (r.description ? `\n${r.description.slice(0, 300)}` : "") +
      `\n→ ${pageUrl()}`;
    await sendMany(targets.map((t) => t.id), msg);
    console.log(`[submissions] 요청 알림 ${targets.length}명 — ${r.title}`);
  } catch (e) {
    console.error("[submissions] 요청 알림 오류:", e);
  }
}

/** 미제출자에게 독촉. kind: manual(본부 버튼) / before(마감 전날) / overdue(마감 지남). 보낸 사람 수를 돌려준다. */
export async function remindRequest(requestId: string, kind: "manual" | "before" | "overdue"): Promise<number> {
  const r = await loadRequest(requestId);
  if (!r) return 0;
  const done = await submittedUserIds(requestId);
  const missing = (await targetUsersFor(r)).filter((t) => !done.has(t.id));
  if (!missing.length) return 0;
  const head = kind === "overdue" ? "⏰ 마감이 지났습니다 — 아직 제출되지 않았습니다" : kind === "before" ? "⏰ 내일이 마감입니다" : "📤 본부에서 제출을 요청했습니다";
  const msg = `${head}\n「${r.title}」\n분류 ${r.category.name} · ${dueText(r.dueDate)}\n→ ${pageUrl()}`;
  await sendMany(missing.map((m) => m.id), msg);
  return missing.length;
}

export async function notifyShared(submissionId: string) {
  try {
    const s = await prisma.submission.findUnique({ where: { id: submissionId }, include: { category: true } });
    if (!s || !s.shared || !s.shareJobGroups.length) return;
    const users = await usersInJobGroups(s.shareJobGroups);
    // 올린 본인에게는 보내지 않는다
    const ids = users.map((u) => u.id).filter((id) => id !== s.userId);
    const who = [s.userBranch, s.userJobGroup, s.userName].filter(Boolean).join(" ");
    const msg = `📎 본부가 자료를 공유했습니다\n「${s.title}」\n${s.category.name} · ${who}\n→ ${pageUrl()}`;
    await sendMany(ids, msg);
    console.log(`[submissions] 공유 알림 ${ids.length}명 — ${s.title}`);
  } catch (e) {
    console.error("[submissions] 공유 알림 오류:", e);
  }
}

async function activeAdminIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true, deletedAt: null }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** 09시 잡 — 마감 전날 독촉·마감 다음날 알림. 멱등: remindedAt / overdueNotifiedAt */
export async function runSubmissionDailyJobs(now: Date = new Date()) {
  const today = todayStrKST(now);
  const tomorrow = todayStrKST(new Date(now.getTime() + 24 * 3600 * 1000));
  const yesterday = todayStrKST(new Date(now.getTime() - 24 * 3600 * 1000));
  const open = await prisma.submissionRequest.findMany({
    where: { closedAt: null, dueDate: { not: null } },
    select: { id: true, title: true, dueDate: true, remindedAt: true, overdueNotifiedAt: true },
  });
  for (const r of open) {
    const due = dateStr(r.dueDate);
    if (due === tomorrow && !r.remindedAt) {
      // 먼저 표시해 두어 다음 틱이 또 보내지 않게 한다
      await prisma.submissionRequest.update({ where: { id: r.id }, data: { remindedAt: now } });
      try { const n = await remindRequest(r.id, "before"); console.log(`[submissions] 마감 전날 독촉 ${n}명 — ${r.title}`); }
      catch (e) { console.error("[submissions] 마감 전날 독촉 오류:", e); }
    }
    if (due === yesterday && !r.overdueNotifiedAt) {
      await prisma.submissionRequest.update({ where: { id: r.id }, data: { overdueNotifiedAt: now } });
      try {
        const n = await remindRequest(r.id, "overdue");
        if (n > 0) {
          const full = await loadRequest(r.id);
          const done = await submittedUserIds(r.id);
          const missing = full ? (await targetUsersFor(full)).filter((t) => !done.has(t.id)) : [];
          const names = missing.map((m) => `${m.branch ?? "-"} ${m.name}`).slice(0, 60).join(", ");
          const admins = await activeAdminIds();
          await sendMany(admins, `📋 「${r.title}」 마감(${due}) 지남 — 미제출 ${missing.length}명\n${names}${missing.length > 60 ? " …" : ""}\n→ ${pageUrl()}`);
        }
        console.log(`[submissions] 마감 지남 알림 ${n}명 — ${r.title}`);
      } catch (e) { console.error("[submissions] 마감 지남 알림 오류:", e); }
    }
  }
  void today;
}

/** 18시 잡 — 오늘 들어온 제출을 본부에 한 통으로. 하나도 없으면 보내지 않는다. */
export async function runSubmissionDigest(now: Date = new Date()) {
  const today = todayStrKST(now);
  // KST 오늘 00:00 = UTC 전날 15:00
  const [y, m, d] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - 9 * 3600 * 1000);
  const rows = await prisma.submission.findMany({
    where: { deletedAt: null, createdAt: { gte: start } },
    select: { requestId: true, request: { select: { title: true } }, category: { select: { name: true } } },
  });
  if (!rows.length) return;
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const k = r.request ? `「${r.request.title}」` : `자유 제출 · ${r.category.name}`;
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  const lines = [...byKey.entries()].map(([k, n]) => `· ${k} ${n}건`).join("\n");
  const admins = await activeAdminIds();
  await sendMany(admins, `📥 오늘 자료 제출 ${rows.length}건\n${lines}\n→ ${pageUrl()}`);
  console.log(`[submissions] 18시 요약 ${rows.length}건 → 본부 ${admins.length}명`);
}
