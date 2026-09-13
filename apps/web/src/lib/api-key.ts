// 개인 API 키 — 발급·인증·속도 제한·이상 감지 (2026-09-13 2단계)
//
// 원칙(디렉터 승인 기획 2-4):
//  1 별도 창구: 키는 /api/v1/* 에서만 통한다. 화면이 쓰는 내부 API 는 키를 아예 받지 않는다(getSession 은 JWT 만 본다).
//  2 원문은 한 번만: 서버에는 sha256 만. 앞 8자(prefix)로 어느 키인지 알아본다.
//  3 본인 권한 이하: 키 요청마다 그 직원의 재직·활성·허용(apiKeysAllowed)을 다시 본다. 퇴사·허용 해제 순간 죽는다.
//  4 범위(scope)와 방(channelIds) 지정.  6 속도 제한.  8 이상 감지(시간당 500회 → 멈춤 + 본인·본부 DM).
import crypto from "crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { isResigned } from "@/lib/resign";
import { maskIp } from "@/lib/mask-ip";
import type { ApiKey } from "@prisma/client";

export const API_SCOPES = ["submissions:read", "submissions:write", "chat:read", "chat:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];
export const API_SCOPE_LABEL: Record<ApiScope, string> = {
  "submissions:read": "자료제출 읽기 — 내야 할 것·내 제출·공유 자료",
  "submissions:write": "자료제출 쓰기 — 파일 올리고 제출",
  "chat:read": "채팅 읽기 — 내가 속한 방과 새 메시지",
  "chat:write": "채팅 쓰기 — 고른 방에 메시지 올리기",
};
export const KEY_PREFIX = "cbt_pk_";
export const MAX_TTL_DAYS = 365;
export const DEFAULT_TTL_DAYS = 90;
export const MAX_KEYS_PER_USER = 10;

/** 원문 생성 — cbt_pk_ + 32자(base64url, 192비트) */
export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const body = crypto.randomBytes(24).toString("base64url");
  const raw = KEY_PREFIX + body;
  return { raw, prefix: body.slice(0, 8), hash: hashApiKey(raw) };
}
export function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export type ApiPrincipal = {
  user: { id: string; name: string; role: string; branch: string | null; jobGroup: string | null; position: string | null };
  key: ApiKey;
};

// ── 속도 제한(인메모리, 프로세스당) ─────────────────────────────
// 키당 분당 60·하루 2,000, 쓰기 분당 10, 파일 올리기 하루 50. 시간당 500 넘으면 이상으로 보고 멈춘다.
type Bucket = { minute: string; minuteCount: number; writeCount: number; hour: string; hourCount: number; day: string; dayCount: number; uploadCount: number };
const g = globalThis as unknown as { __apiKeyBuckets?: Map<string, Bucket> };
const buckets: Map<string, Bucket> = g.__apiKeyBuckets ?? (g.__apiKeyBuckets = new Map());
// 이상 감지 기준은 허용치(분당 60 = 시간당 최대 3,600)와 충돌하지 않게 **받아들인 요청** 기준 시간당 1,500 (검증관 P1).
const LIMITS = { perMinute: 60, perDay: 2000, writesPerMinute: 10, uploadsPerDay: 50, anomalyPerHour: 1500 };

/** 멈춤 해제(resume) 때 버킷도 비운다 — 안 비우면 첫 요청에서 바로 다시 멈추고 DM 이 또 나간다(검증관 C2) */
export function resetApiKeyBucket(keyId: string) { buckets.delete(keyId); }

function keys(now: Date) {
  const iso = now.toISOString();
  return { minute: iso.slice(0, 16), hour: iso.slice(0, 13), day: iso.slice(0, 10) };
}
function bucketFor(id: string, now: Date): Bucket {
  const k = keys(now);
  let b = buckets.get(id);
  if (!b) { b = { minute: k.minute, minuteCount: 0, writeCount: 0, hour: k.hour, hourCount: 0, day: k.day, dayCount: 0, uploadCount: 0 }; buckets.set(id, b); }
  if (b.minute !== k.minute) { b.minute = k.minute; b.minuteCount = 0; b.writeCount = 0; }
  if (b.hour !== k.hour) { b.hour = k.hour; b.hourCount = 0; }
  if (b.day !== k.day) { b.day = k.day; b.dayCount = 0; b.uploadCount = 0; }
  // 오래된 키 정리(메모리) — 1,000개 넘으면 오늘 안 쓴 것부터
  if (buckets.size > 1000) for (const [kid, kb] of buckets) if (kb.day !== k.day) buckets.delete(kid);
  return b;
}

export function v1Error(status: number, error: string, code: string) {
  return NextResponse.json({ error, code }, { status });
}

function clientIp(request: NextRequest): string | null {
  const xff = request.headers.get("x-forwarded-for");
  return xff ? xff.split(",")[0].trim() : null;
}

/**
 * /api/v1 인증. 성공하면 주체(사용자+키), 실패하면 응답.
 * kind: "read" | "write" | "upload" — 쓰기·업로드는 더 낮은 한도를 적용한다.
 */
export async function authenticateApiKey(
  request: NextRequest,
  scope: ApiScope | null, // null = 범위 검사 없이 유효한 키인지만(/me)
  kind: "read" | "write" | "upload" = "read",
): Promise<{ ok: true; p: ApiPrincipal } | { ok: false; res: NextResponse }> {
  const auth = request.headers.get("authorization") || "";
  const m = /^Bearer\s+(cbt_pk_[A-Za-z0-9_-]{20,})$/i.exec(auth.trim());
  if (!m) return { ok: false, res: v1Error(401, "API 키가 필요합니다. Authorization: Bearer cbt_pk_… 로 보내주세요.", "NO_KEY") };
  const key = await prisma.apiKey.findUnique({ where: { keyHash: hashApiKey(m[1]) } });
  if (!key) return { ok: false, res: v1Error(401, "키가 올바르지 않습니다.", "BAD_KEY") };
  if (key.revokedAt) return { ok: false, res: v1Error(401, "꺼진 키입니다. 프로필에서 새 키를 만들어주세요.", "REVOKED") };
  if (key.expiresAt.getTime() < Date.now()) return { ok: false, res: v1Error(401, "만료된 키입니다. 프로필에서 새 키를 만들어주세요.", "EXPIRED") };
  if (key.suspendedAt) return { ok: false, res: v1Error(403, `이상 사용이 감지되어 멈춘 키입니다(${key.suspendReason ?? ""}). 프로필에서 확인 후 다시 켤 수 있습니다.`, "SUSPENDED") };
  if (scope && !key.scopes.includes(scope)) return { ok: false, res: v1Error(403, `이 키에는 '${scope}' 권한이 없습니다.`, "NO_SCOPE") };

  const u = await prisma.user.findUnique({
    where: { id: key.userId },
    select: { id: true, name: true, role: true, branch: true, jobGroup: true, position: true, isActive: true, deletedAt: true, employmentStatus: true, resignDate: true, apiKeysAllowed: true },
  });
  if (!u || !u.isActive || u.deletedAt || u.employmentStatus === "RESIGNED" || isResigned(u.resignDate))
    return { ok: false, res: v1Error(401, "사용할 수 없는 계정입니다.", "USER_INACTIVE") };
  if (!u.apiKeysAllowed) return { ok: false, res: v1Error(403, "API 키 사용 허용이 꺼져 있습니다. 본부에 문의해주세요.", "NOT_ALLOWED") };

  // 속도 제한 — 거부(429)된 요청은 시간당 이상 감지 집계에 넣지 않는다(재시도하는 클라이언트가 더 빨리 멈추는 것을 막는다)
  const now = new Date();
  const b = bucketFor(key.id, now);
  b.minuteCount++; b.dayCount++;
  if (kind !== "read") b.writeCount++;
  if (kind === "upload") b.uploadCount++;
  if (b.minuteCount > LIMITS.perMinute) return { ok: false, res: v1Error(429, `분당 ${LIMITS.perMinute}회를 넘었습니다. 잠시 뒤 다시 시도해주세요.`, "RATE_MINUTE") };
  if (b.dayCount > LIMITS.perDay) return { ok: false, res: v1Error(429, `하루 ${LIMITS.perDay}회를 넘었습니다.`, "RATE_DAY") };
  if (kind !== "read" && b.writeCount > LIMITS.writesPerMinute) return { ok: false, res: v1Error(429, `쓰기는 분당 ${LIMITS.writesPerMinute}회까지입니다.`, "RATE_WRITE") };
  if (kind === "upload" && b.uploadCount > LIMITS.uploadsPerDay) return { ok: false, res: v1Error(429, `파일 올리기(요청)는 하루 ${LIMITS.uploadsPerDay}회까지입니다.`, "RATE_UPLOAD") };
  b.hourCount++;
  if (b.hourCount > LIMITS.anomalyPerHour) {
    await suspendKey(key, `1시간에 ${LIMITS.anomalyPerHour}회 초과`).catch(() => {});
    return { ok: false, res: v1Error(403, "이상 사용이 감지되어 키를 멈췄습니다. 본인과 본부에 알렸습니다.", "SUSPENDED") };
  }

  // 마지막 사용 — 1분에 한 번만 기록(매 요청 UPDATE 방지). 응답을 막지 않는다.
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > 60_000) {
    const ip = maskIp(clientIp(request));
    void prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: now, lastUsedIp: ip === "-" ? null : ip } }).catch(() => {});
  }
  return { ok: true, p: { user: { id: u.id, name: u.name, role: u.role, branch: u.branch, jobGroup: u.jobGroup, position: u.position }, key } };
}

/** 이상 감지로 멈춤 + 본인·본부 DM. 이미 멈춘 키면 아무것도 안 한다. */
async function suspendKey(key: ApiKey, reason: string) {
  const r = await prisma.apiKey.updateMany({ where: { id: key.id, suspendedAt: null }, data: { suspendedAt: new Date(), suspendReason: reason } });
  if (!r.count) return;
  const { botSendDM } = await import("@/lib/bot");
  const owner = await prisma.user.findUnique({ where: { id: key.userId }, select: { name: true } });
  const msg = `⚠️ API 키 「${key.name}」(${key.prefix}…)이 이상 사용(${reason})으로 멈췄습니다. 본인이 쓴 것이 아니면 프로필에서 키를 끄고 새로 만드세요.`;
  await botSendDM(key.userId, msg);
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true, deletedAt: null }, select: { id: true } });
  for (const a of admins) await botSendDM(a.id, `⚠️ ${owner?.name ?? key.userId} 님의 API 키 「${key.name}」이 이상 사용(${reason})으로 멈췄습니다.`);
  const { logAudit } = await import("@/lib/audit");
  await logAudit({ actorId: "system", actorName: "시스템", action: "API_KEY_SUSPEND", targetType: "API_KEY", targetId: key.id, targetName: key.name, detail: reason });
}

/**
 * 파일 서빙·PDF 미리보기가 키 요청도 받게 하는 다리(검증관 C3) — 유효한 submissions:read 키면 `u:<userId>` 주체를 돌려준다.
 * 파일 접근 판정(canAccessSubmissionFile)은 그 주체로 세션·티켓과 똑같이 한다.
 */
export async function apiKeyFileSubject(request: NextRequest): Promise<string | null> {
  if (!/^Bearer\s+cbt_pk_/i.test(request.headers.get("authorization") || "")) return null;
  const a = await authenticateApiKey(request, "submissions:read");
  return a.ok ? `u:${a.p.user.id}` : null;
}

/** 목록 응답용 — 원문·해시는 절대 싣지 않는다 */
export function publicKey(k: ApiKey) {
  return {
    id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, channelIds: k.channelIds,
    expiresAt: k.expiresAt, lastUsedAt: k.lastUsedAt, lastUsedIp: k.lastUsedIp,
    suspendedAt: k.suspendedAt, suspendReason: k.suspendReason, revokedAt: k.revokedAt, createdAt: k.createdAt,
    status: k.revokedAt ? "revoked" : k.suspendedAt ? "suspended" : k.expiresAt.getTime() < Date.now() ? "expired" : "active",
  };
}
