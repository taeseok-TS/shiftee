// 채팅 첨부(uploads/work) 파일 접근 판정 — 2026-10-01 디렉터 지시("남은 것도 처리해 버리자").
//
// uploads/work 는 채팅만 쓰는 폴더가 아니다. 같은 업로더(/api/work/upload)를 7가지 기능이 함께 쓴다:
//   채팅 메시지(fileUrl·albumUrls) / 방 공지 이미지 / 예약 메시지 첨부 / 회사 공지(첨부·본문 이미지) /
//   개선 제안 스크린샷 / 휴가 증빙 / 봇 브리핑 카드뉴스 — 그리고 회의 녹화(work/recordings/).
// 종전에는 주소만 알면 로그인 없이도 열렸다(업로드 게이트 밖). 파일마다 "그 파일을 쓰는 기능에서 볼 수 있는
// 사람"이면 허용한다(쓰는 곳이 여럿이면 그중 하나라도). 판정은 이 한 곳에서 한다.
//
// ⚠ 2026-09-02 에 이 경로를 "로그인만" 보는 게이트로 켰다가 앱 첨부가 전부 401 이 된 사고가 있었다.
//   그래서 먼저 **observe(기록만)** 로 돌려 "막았다면 막혔을 요청"을 모은 뒤, 정상 사용이 막히지 않는 것을
//   확인하고 enforce 로 바꾼다. 모드는 env UPLOADS_WORK_MODE: observe(기본) | enforce | off
//   (docker-compose 에 명시돼 있어 .env 로 바꾸고 컨테이너만 다시 올리면 된다).
// ⚠ 판정이 실패해도(DB 흔들림) 파일 서빙이 깨지면 안 된다 — observe 에서는 기록하고 그대로 내준다(검증관 C1).
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

export type WorkGateMode = "observe" | "enforce" | "off";
export function workGateMode(): WorkGateMode {
  const v = (process.env.UPLOADS_WORK_MODE ?? "").trim().toLowerCase();
  return v === "enforce" ? "enforce" : v === "off" ? "off" : "observe";
}

// ─── 올린 사람 표식 ─────────────────────────────
// 올린 직후(아직 메시지·공지 등에 붙기 전) 파일은 어느 기능에도 매여 있지 않아 누구 것인지 알 수 없다 —
// 미리보기가 막히지 않게 파일명에 올린 사람의 짧은 HMAC 을 박는다(자료제출 uploaderTag 와 같은 방식, 키 구분 "workup:").
// 파일명: <13자리 시각>-<임의 7자>-w<태그8>-<원래 이름>. 옛 파일(표식 없음)은 기능 연결로만 판정한다.
export function workUploaderTag(userId: string): string {
  return crypto.createHmac("sha256", process.env.JWT_SECRET || "").update(`workup:${userId}`).digest("hex").slice(0, 8);
}
export function workFileBelongsTo(fileName: string, userId: string): boolean {
  const m = /^\d{13}-[a-z0-9]{1,10}-w([0-9a-f]{8})-/.exec(fileName);
  return !!m && !!process.env.JWT_SECRET && m[1] === workUploaderTag(userId);
}

export type WorkViewer = { userId: string; role: string };

/**
 * 이 사람이 이 work 파일을 볼 수 있는가. segments = uploads/work 아래 경로 조각(디코드된 것).
 * 이유 문자열은 기록용. 오류는 던진다(부르는 쪽 judgeWorkFileRequest 가 잡는다).
 */
export async function canAccessWorkFile(segments: string[], viewer: WorkViewer): Promise<{ allowed: boolean; reason: string }> {
  if (viewer.role === "ADMIN") return { allowed: true, reason: "admin" };
  const fileName = segments[segments.length - 1] || "";
  if (workFileBelongsTo(fileName, viewer.userId)) return { allowed: true, reason: "uploader" };

  const url = `/api/uploads/work/${segments.join("/")}`;
  const urls = [url];
  const enc = `/api/uploads/work/${segments.map((s) => encodeURIComponent(s)).join("/")}`;
  if (enc !== url) urls.push(enc);

  // 1) 채팅 메시지 — **내가 볼 수 있는 방의** 메시지 중에서만 찾는다(한 번의 조회).
  //    과거 기록 범위(초대 전 글, 초대 전 글에 달린 답글)는 아래에서 거른다. 삭제된 메시지는 근거가 되지 않는다.
  //    (종전 안은 아무 방 메시지 20건을 먼저 집어 하나씩 봐서, 같은 파일을 여러 방이 쓰면 내 방이 빠질 수 있었다 — 검증관 P1)
  const msgs = await prisma.workMessage.findMany({
    where: {
      deletedAt: null,
      OR: [{ fileUrl: { in: urls } }, ...urls.map((u) => ({ albumUrls: { array_contains: [u] } }))],
      channel: { OR: [{ isDefault: true }, { members: { some: { userId: viewer.userId } } }] },
    },
    select: {
      createdAt: true,
      parent: { select: { createdAt: true } },
      channel: { select: { members: { where: { userId: viewer.userId }, select: { historyFrom: true } } } },
    },
    take: 50,
  });
  for (const m of msgs) {
    const hf = m.channel.members[0]?.historyFrom;
    if (!hf || (m.createdAt >= hf && (!m.parent || m.parent.createdAt >= hf))) return { allowed: true, reason: "message" };
  }

  // 2) 방 공지 이미지 — 그 방 사람
  const notice = await prisma.workChannel.findFirst({
    where: { noticeImageUrl: { in: urls }, OR: [{ isDefault: true }, { members: { some: { userId: viewer.userId } } }] },
    select: { id: true },
  });
  if (notice) return { allowed: true, reason: "notice" };

  // 3) 예약 메시지 첨부(대기 중) — 쓴 사람
  const sched = await prisma.workScheduledMessage.findFirst({
    where: { userId: viewer.userId, sentAt: null, canceledAt: null, OR: urls.map((u) => ({ attachments: { array_contains: [{ fileUrl: u }] } })) },
    select: { id: true },
  });
  if (sched) return { allowed: true, reason: "scheduled" };

  // 4) 회사 공지(첨부·본문 이미지) — 로그인한 직원 모두
  const ann = await prisma.workAnnouncement.findFirst({
    where: { OR: urls.flatMap((u) => [{ attachments: { contains: u } }, { content: { contains: u } }]) },
    select: { id: true },
  });
  if (ann) return { allowed: true, reason: "announcement" };

  // 5) 개선 제안 스크린샷 — 작성자(본부는 위에서 허용)
  const sg = await prisma.suggestion.findFirst({
    where: { userId: viewer.userId, OR: urls.map((u) => ({ imageUrls: { array_contains: [u] } })) },
    select: { id: true },
  });
  if (sg) return { allowed: true, reason: "suggestion" };

  // 6) 휴가 증빙 — 신청자, 결재자(고정·단계), 원장은 결재 단계의 지점(신청 당시 고정) 또는 신청자의 지금 지점
  //    (결재함은 단계의 지점으로 보인다 — 신청자가 지점을 옮겨도 그 건을 결재할 원장이 증빙을 볼 수 있게, 검증관 P2)
  const leaves = await prisma.leaveRequest.findMany({
    where: { attachmentUrl: { in: urls } },
    select: {
      userId: true, approverId: true,
      user: { select: { branch: true } },
      approvalSteps: { select: { approverId: true, branch: true } },
    },
    take: 5,
  });
  if (leaves.length) {
    let myBranches: string[] | null = null;
    for (const l of leaves) {
      if (l.userId === viewer.userId || l.approverId === viewer.userId) return { allowed: true, reason: "leave" };
      if (l.approvalSteps.some((s) => s.approverId === viewer.userId)) return { allowed: true, reason: "leave" };
      if (viewer.role === "MANAGER") {
        myBranches ??= await getManagerBranches(viewer.userId);
        const branches = [l.user.branch, ...l.approvalSteps.map((s) => s.branch)].filter((b): b is string => !!b);
        if (branches.some((b) => myBranches!.includes(b))) return { allowed: true, reason: "leave" };
      }
    }
  }

  // 7) 회의 녹화 — 녹화한 사람
  const rec = await prisma.workMeetingRecording.findFirst({ where: { fileUrl: { in: urls }, createdBy: viewer.userId }, select: { id: true } });
  if (rec) return { allowed: true, reason: "recording" };

  // (봇 브리핑 카드뉴스는 보내기 전엔 본부만, 보낸 뒤엔 채팅 메시지로 1번에서 잡힌다)
  return { allowed: false, reason: "no-link" };
}

// ─── 붙이기 검사 ─────────────────────────────
// 판정은 "이 파일이 내가 볼 수 있는 곳(메시지·예약·제안·휴가 등)에 붙어 있나"로 허용한다. 그래서 붙이는 쪽이
// 아무 work 주소나 받으면, 남의 방 파일 주소를 내 방 메시지(또는 내 예약·방 공지·제안·휴가)에 붙여 **스스로 열 근거를
// 만들 수 있었다**(2026-10-06 검증관). 붙이는 사람이 지금 볼 수 있는 파일만 붙이게 한다 —
// 방금 올린 파일(내 표식)·전달(이미 보이는 파일)은 그대로 된다. work 가 아닌 주소는 여기서 판단하지 않는다(각 경로의 기존 검사).
// 모드(observe·enforce)와 상관없이 늘 본다 — 관찰 기간에 이 근거가 섞여 들어가면 잠금 뒤에 새는 길로 남는다.
export async function canAttachWorkUrl(url: unknown, viewer: WorkViewer): Promise<boolean> {
  if (typeof url !== "string") return false;
  const bare = url.split("?")[0].split("#")[0];
  const prefix = "/api/uploads/work/";
  if (!bare.startsWith(prefix)) return true;
  let segs: string[];
  try {
    segs = bare.slice(prefix.length).split("/").map((s) => decodeURIComponent(s));
  } catch {
    return false;
  }
  if (!segs.length || segs.some((s) => !s || s === "." || s === ".." || s.includes("/") || s.includes("\\"))) return false;
  try {
    return (await canAccessWorkFile(segs, viewer)).allowed;
  } catch {
    return false; // 판정이 안 되면 붙이지 않는다(나중에 다시 보내면 된다)
  }
}
/** 여러 주소 중 붙일 수 없는 첫 주소(없으면 null) */
export async function firstUnattachableWorkUrl(urls: unknown[], viewer: WorkViewer): Promise<string | null> {
  for (const u of urls) {
    if (u === null || u === undefined || u === "") continue;
    if (!(await canAttachWorkUrl(u, viewer))) return typeof u === "string" ? u : "?";
  }
  return null;
}
export const UNATTACHABLE_MSG = "볼 수 없는 파일은 첨부할 수 없습니다. 파일을 다시 올려 주세요.";

// ─── 판정 기억 — 채팅 화면은 같은 사진을 여러 번 부르고 영상은 조각(Range)으로 여러 번 부른다 ───
// 허용·거부 모두 1분 기억한다(거부를 매번 다시 보면 거부되는 요청마다 조회가 반복된다 — 검증관 C3).
const DECISION_TTL_MS = 60_000;
type Decision = { at: number; allowed: boolean; reason: string };
const gc = globalThis as unknown as { __workFileDecision?: Map<string, Decision>; __workViewer?: Map<string, { at: number; viewer: WorkViewer | null }> };
const decisionCache: Map<string, Decision> = gc.__workFileDecision ?? (gc.__workFileDecision = new Map());
const viewerCache = gc.__workViewer ?? (gc.__workViewer = new Map());

function prune<T extends { at: number }>(m: Map<string, T>, now: number) {
  if (m.size > 20_000) for (const [k, v] of m) if (now - v.at >= DECISION_TTL_MS) m.delete(k);
}

export async function canAccessWorkFileCached(segments: string[], viewer: WorkViewer): Promise<{ allowed: boolean; reason: string }> {
  const key = `${viewer.userId}|${segments.join("/")}`;
  const now = Date.now();
  const hit = decisionCache.get(key);
  if (hit && now - hit.at < DECISION_TTL_MS) return { allowed: hit.allowed, reason: hit.allowed ? "cached" : hit.reason };
  const r = await canAccessWorkFile(segments, viewer);
  decisionCache.set(key, { at: now, allowed: r.allowed, reason: r.reason });
  prune(decisionCache, now);
  return r;
}

/** 티켓 주체(u:<id>~<세션번호>) → 사람. 영상 조각 요청마다 사용자를 다시 읽지 않게 1분 기억 */
async function viewerFromTicket(subject: string): Promise<WorkViewer | null> {
  const now = Date.now();
  const hit = viewerCache.get(subject);
  if (hit && now - hit.at < DECISION_TTL_MS) return hit.viewer;
  const { resolveSubmissionViewer } = await import("@/lib/submission-access");
  const v = await resolveSubmissionViewer(null, subject);
  const viewer = v ? { userId: v.userId, role: v.role } : null;
  viewerCache.set(subject, { at: now, viewer });
  prune(viewerCache, now);
  return viewer;
}

// ─── observe 기록 — 컨테이너를 다시 띄워도 남게 볼륨(uploads/private)에 하루 한 파일 ───
// 같은 (사람·파일·이유) 는 한 시간에 한 줄만 — 앱이 같은 사진을 계속 부르면 며칠 안에 상한이 차서 근거가 끊긴다(검증관 note).
const LOG_MAX_BYTES = 5 * 1024 * 1024;
const gl = globalThis as unknown as { __workGateSeen?: Map<string, number> };
const seen: Map<string, number> = gl.__workGateSeen ?? (gl.__workGateSeen = new Map());
export async function logWorkGate(entry: Record<string, unknown>, dedupeKey?: string): Promise<void> {
  try {
    const now = Date.now();
    if (dedupeKey) {
      const last = seen.get(dedupeKey);
      if (last && now - last < 3600_000) return;
      // 넘치면 통째로 비운다 — 오래된 것만 골라 지우는 순회는 요청마다 맵 전체를 돌아 폭주 때 느려진다(재검증관)
      if (seen.size >= 20_000) seen.clear();
      seen.set(dedupeKey, now);
    }
    const kst = new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
    const p = path.join(process.cwd(), "uploads", "private", `work-gate-${kst}.log`);
    const st = await fs.stat(p).catch(() => null);
    if (st && st.size > LOG_MAX_BYTES) return;
    await fs.mkdir(path.dirname(p), { recursive: true });
    // 그날 첫 줄을 쓸 때 14일 지난 기록 파일을 지운다(하루 최대 5MB 가 계속 쌓이지 않게)
    if (!st) {
      const dir = path.dirname(p);
      const cut = new Date(now + 9 * 3600_000 - 14 * 86400_000).toISOString().slice(0, 10);
      for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
        const d = /^work-gate-(\d{4}-\d{2}-\d{2})\.log$/.exec(f)?.[1];
        if (d && d < cut) await fs.unlink(path.join(dir, f)).catch(() => {});
      }
    }
    await fs.appendFile(p, JSON.stringify({ at: new Date(now).toISOString(), ...entry }) + "\n");
  } catch { /* 기록 실패는 파일 서빙을 막지 않는다 */ }
}

/**
 * 요청 하나에 대한 work 파일 판정 — 세션(웹 쿠키·Bearer) 또는 티켓(?t=, 앱·외부 뷰어) 주체로.
 * observe 모드에서는 거부 판정을 기록만 하고 통과시킨다. 반환값 block 이 true 일 때만 막는다.
 * **절대 던지지 않는다** — 판정 중 오류(DB 흔들림 등)는 observe 면 기록하고 내주고, enforce 면 503.
 */
export async function judgeWorkFileRequest(opts: {
  segments: string[];
  session: { userId: string; role: string } | null;
  ticketSubject: string | null;
  userAgent: string;
  via: string;
}): Promise<{ block: boolean; status: number; error: string }> {
  const mode = workGateMode();
  if (mode === "off") return { block: false, status: 200, error: "" };
  const file = opts.segments.join("/");
  let viewer: WorkViewer | null = null;
  let status = 200;
  let reason = "";
  try {
    if (opts.session) viewer = { userId: opts.session.userId, role: opts.session.role };
    else if (opts.ticketSubject) viewer = await viewerFromTicket(opts.ticketSubject);
    if (!viewer) { status = 401; reason = opts.session || opts.ticketSubject ? "inactive-or-stale-ticket" : "no-auth"; }
    else {
      const r = await canAccessWorkFileCached(opts.segments, viewer);
      if (!r.allowed) { status = 403; reason = r.reason; }
    }
  } catch (e) {
    void logWorkGate({ mode, via: opts.via, status: "error", reason: "judge-error", error: String((e as Error)?.message ?? e).slice(0, 200), file, user: viewer?.userId ?? null }, `err|${file}`);
    if (mode === "enforce") return { block: true, status: 503, error: "잠시 후 다시 시도해주세요." };
    return { block: false, status: 200, error: "" };
  }
  if (status === 200) return { block: false, status, error: "" };
  void logWorkGate({
    mode, via: opts.via, status, reason, file,
    user: viewer?.userId ?? null, hasSession: !!opts.session, hasTicket: !!opts.ticketSubject,
    ua: opts.userAgent.slice(0, 100),
  }, `${viewer?.userId ?? "anon"}|${file}|${reason}`); // 익명은 브라우저 문자열을 키에 넣지 않는다 — 바꿔 가며 키를 무한히 늘릴 수 있다
  if (mode !== "enforce") return { block: false, status: 200, error: "" };
  return { block: true, status, error: status === 401 ? "인증이 필요합니다." : "이 파일을 볼 권한이 없습니다." };
}
