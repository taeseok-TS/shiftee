import { prisma } from "@/lib/db";

// ─── 전자계약 발송 부가 정보(2026-10-07 QA76 묶음 7-가) ─────────────────────
//  · #65 발송 메시지 — 본부가 정한 기본 문구(AppSetting contractSendMessage)를 발송 창에 채우고, 보낸 문구는 계약에 남겨
//    알림(봇 DM)·메일·서명 화면에 보여 준다.
//  · #47 중복 발송 경고 — 같은 직원·같은 양식이 진행 중이거나 30일 안에 보낸 적이 있으면 발송 전에 묻는다(막지는 않는다).

const KEY = "contractSendMessage";
export const SEND_MESSAGE_MAX = 500;

export async function readDefaultSendMessage(): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { key: KEY } }).catch(() => null);
  return row?.value ?? "";
}

export async function saveDefaultSendMessage(text: string): Promise<void> {
  await prisma.appSetting.upsert({ where: { key: KEY }, create: { key: KEY, value: text }, update: { value: text } });
}

/** 받은 값 → 저장할 문구(글자만, 앞뒤 공백 제거, 상한). 빈 값·글자 아님은 null */
export function normalizeSendMessage(v: unknown): string | null | "TOO_LONG" {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > SEND_MESSAGE_MAX ? "TOO_LONG" : t;
}

/** 봇 DM 끝에 붙이는 줄 */
export const messageDmLine = (m: string | null | undefined) => (m ? `\n\n💬 본부 메시지\n${m}` : "");

/** 메일 본문에 넣는 상자(HTML 이스케이프) */
export function messageEmailHtml(m: string | null | undefined): string {
  if (!m) return "";
  const esc = m.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/\n/g, "<br>");
  return `<div style="background:#eef2ff;padding:12px 15px;margin:16px 0;border-left:4px solid #6366f1;"><p style="margin:0 0 4px;font-weight:bold;">본부 메시지</p><p style="margin:0;">${esc}</p></div>`;
}

export type DuplicateSend = { id: string; title: string; status: string; lastSentAt: string | null };

const DUP_DAYS = 30;

/**
 * 같은 직원에게 같은 양식(템플릿이 없으면 같은 종류·같은 제목)을 진행 중(SENT·APPROVED)이거나 30일 안에 보낸 계약.
 * 외부 계약(userId = 작성 관리자)은 보지 않는다. 같은 패키지 문서·자기 자신은 뺀다.
 */
export async function findDuplicateSends(c: {
  id: string; userId: string; templateId: string | null; type: string; title: string;
  externalName: string | null; bundleId?: string | null;
}): Promise<DuplicateSend[]> {
  if (c.externalName) return [];
  const since = new Date(Date.now() - DUP_DAYS * 86400000);
  const rows = await prisma.contract.findMany({
    where: {
      userId: c.userId,
      externalName: null,
      id: { not: c.id },
      ...(c.bundleId ? { OR: [{ bundleId: null }, { bundleId: { not: c.bundleId } }] } : {}),
      ...(c.templateId ? { templateId: c.templateId } : { templateId: null, type: c.type as never, title: c.title }),
      status: { not: "DRAFT" },
    },
    select: {
      id: true, title: true, status: true,
      events: { where: { type: { in: ["SENT", "RESEND"] } }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
    },
    take: 20,
  });
  return rows
    .filter((r) => r.status === "SENT" || r.status === "APPROVED" || (r.events[0] && r.events[0].createdAt >= since))
    .map((r) => ({ id: r.id, title: r.title, status: r.status, lastSentAt: r.events[0]?.createdAt.toISOString() ?? null }));
}
