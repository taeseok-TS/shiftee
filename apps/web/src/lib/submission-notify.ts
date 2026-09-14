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
import { kstTodayMidnight } from "@/lib/resign";

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
export async function remindRequest(requestId: string, kind: "manual" | "before" | "today" | "overdue"): Promise<number> {
  const r = await loadRequest(requestId);
  if (!r) return 0;
  const done = await submittedUserIds(requestId);
  const missing = (await targetUsersFor(r)).filter((t) => !done.has(t.id));
  if (!missing.length) return 0;
  const head = kind === "overdue" ? "⏰ 마감이 지났습니다 — 아직 제출되지 않았습니다" : kind === "before" ? "⏰ 내일이 마감입니다" : kind === "today" ? "⏰ 오늘이 마감입니다" : "📤 본부에서 제출을 요청했습니다";
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
  const rows = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true, deletedAt: null, AND: [{ OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] }] },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/** 09시 잡 — 마감 전날 독촉·마감 다음날 알림. 멱등: remindedAt / overdueNotifiedAt */
export async function runSubmissionDailyJobs(now: Date = new Date()) {
  const today = todayStrKST(now);
  const tomorrow = todayStrKST(new Date(now.getTime() + 24 * 3600 * 1000));
  const open = await prisma.submissionRequest.findMany({
    where: { closedAt: null, dueDate: { not: null } },
    select: { id: true, title: true, dueDate: true, remindedAt: true, overdueNotifiedAt: true },
  });
  for (const r of open) {
    const due = dateStr(r.dueDate);
    if (!due) continue;
    // 등호가 아니라 범위로 — 09시 틱을 놓친 날이 있어도 다음 틱이 따라잡는다(검증관 8). 표시는 먼저 해 두어 중복을 막는다.
    if (due <= tomorrow && due >= today && !r.remindedAt) {
      await prisma.submissionRequest.update({ where: { id: r.id }, data: { remindedAt: now } });
      try { const n = await remindRequest(r.id, due === today ? "today" : "before"); console.log(`[submissions] 마감 임박 독촉 ${n}명 — ${r.title}`); }
      catch (e) { console.error("[submissions] 마감 임박 독촉 오류:", e); }
    }
    if (due < today && !r.overdueNotifiedAt) {
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
  try { await sweepOrphanUploads(); } catch (e) { console.error("[submissions] 고아 파일 정리 오류:", e); }
}

/**
 * 올리기만 하고 제출하지 않은 파일 정리(검증관 5) — 24시간 넘게 어느 제출물에도 매이지 않은 파일을 지운다.
 * 파일명 앞의 타임스탬프(업로드 시각)로 나이를 본다. 삭제된 제출물의 파일도 "매인" 것으로 쳐서 남긴다(본부가 볼 수 있다).
 */
export async function sweepOrphanUploads(now: Date = new Date()) {
  const fs = await import("fs/promises");
  const path = await import("path");
  const dir = path.join(process.cwd(), "uploads", "submissions");
  let names: string[];
  try { names = await fs.readdir(dir); } catch { return; }
  const cutoff = now.getTime() - 24 * 3600 * 1000;
  const old = names.filter((name) => { const ts = Number(/^(\d{13})-/.exec(name)?.[1]); return ts && ts <= cutoff; });
  if (!old.length) return;
  // 제출물의 파일 URL 을 한 번에 읽어 메모리에서 차집합 — 파일마다 JSONB 조회를 돌리면 매일 선형으로 느려진다(재검증관 2)
  const rows = await prisma.submission.findMany({ select: { files: true } });
  const used = new Set<string>();
  for (const r of rows) for (const f of (Array.isArray(r.files) ? r.files : []) as { url?: unknown }[]) if (typeof f?.url === "string") used.add(f.url);
  let removed = 0;
  for (const name of old) {
    if (used.has(`/api/uploads/submissions/${name}`) || used.has(`/api/uploads/submissions/${encodeURIComponent(name)}`)) continue;
    await fs.unlink(path.join(dir, name)).catch(() => {});
    removed++;
  }
  if (removed) console.log(`[submissions] 미제출 고아 파일 ${removed}개 정리`);
}

/** 18시 잡 — 어제 18시부터 오늘 18시(KST) 사이에 들어온 제출을 본부에 한 통으로. 하나도 없으면 보내지 않는다.
 *  (검증관 1: "오늘 00시부터"로 잡으면 18시 이후 제출이 어느 요약에도 안 실린다) */
export async function runSubmissionDigest(now: Date = new Date()) {
  const today = todayStrKST(now);
  // KST 오늘 18:00 = UTC 오늘 09:00
  const [y, m, d] = today.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d, 9));
  const start = new Date(end.getTime() - 24 * 3600 * 1000);
  const rows = await prisma.submission.findMany({
    where: { deletedAt: null, createdAt: { gte: start, lt: end } },
    select: { requestId: true, request: { select: { title: true } }, category: { select: { name: true, group: true } } },
  });
  if (!rows.length) return;
  const byKey = new Map<string, number>();
  for (const r of rows) {
    const k = r.category.group === "MARKETING" ? `마케팅 자료 · ${r.category.name}` : r.request ? `「${r.request.title}」` : `자유 제출 · ${r.category.name}`;
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  const lines = [...byKey.entries()].map(([k, n]) => `· ${k} ${n}건`).join("\n");
  const admins = await activeAdminIds();
  await sendMany(admins, `📥 오늘 자료 제출 ${rows.length}건\n${lines}\n→ ${pageUrl()}`);
  console.log(`[submissions] 18시 요약 ${rows.length}건 → 본부 ${admins.length}명`);
}
