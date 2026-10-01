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
//   확인하고 enforce 로 바꾼다. 모드는 env UPLOADS_WORK_MODE: observe(기본) | enforce | off.
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { assertMessageAccess } from "@/lib/work-access";

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
 * 이유 문자열은 기록용.
 */
export async function canAccessWorkFile(segments: string[], viewer: WorkViewer): Promise<{ allowed: boolean; reason: string }> {
  if (viewer.role === "ADMIN") return { allowed: true, reason: "admin" };
  const fileName = segments[segments.length - 1] || "";
  if (workFileBelongsTo(fileName, viewer.userId)) return { allowed: true, reason: "uploader" };

  const rel = segments.join("/");
  const url = `/api/uploads/work/${rel}`;
  const urls = [url];
  const enc = `/api/uploads/work/${segments.map((s) => encodeURIComponent(s)).join("/")}`;
  if (enc !== url) urls.push(enc);

  // 1) 채팅 메시지 — 그 방 사람 + 과거 기록 범위(삭제된 메시지는 근거가 되지 않는다)
  const msgs = await prisma.workMessage.findMany({
    where: { deletedAt: null, OR: [{ fileUrl: { in: urls } }, ...urls.map((u) => ({ albumUrls: { array_contains: [u] } }))] },
    select: { id: true },
    take: 20,
  });
  for (const m of msgs) {
    if ((await assertMessageAccess(m.id, viewer.userId)).ok) return { allowed: true, reason: "message" };
  }

  // 2) 방 공지 이미지 — 그 방 사람
  const notices = await prisma.workChannel.findMany({
    where: { noticeImageUrl: { in: urls } },
    select: { id: true, isDefault: true, members: { where: { userId: viewer.userId }, select: { userId: true } } },
    take: 10,
  });
  if (notices.some((c) => c.isDefault || c.members.length > 0)) return { allowed: true, reason: "notice" };

  // 3) 예약 메시지 첨부(대기 중) — 쓴 사람
  for (const u of urls) {
    const sched = await prisma.workScheduledMessage.findFirst({
      where: { userId: viewer.userId, sentAt: null, canceledAt: null, attachments: { array_contains: [{ fileUrl: u }] } },
      select: { id: true },
    });
    if (sched) return { allowed: true, reason: "scheduled" };
  }

  // 4) 회사 공지(첨부·본문 이미지) — 로그인한 직원 모두
  const ann = await prisma.workAnnouncement.findFirst({
    where: { OR: urls.flatMap((u) => [{ attachments: { contains: u } }, { content: { contains: u } }]) },
    select: { id: true },
  });
  if (ann) return { allowed: true, reason: "announcement" };

  // 5) 개선 제안 스크린샷 — 작성자(본부는 위에서 허용)
  for (const u of urls) {
    const sg = await prisma.suggestion.findFirst({
      where: { userId: viewer.userId, imageUrls: { array_contains: [u] } },
      select: { id: true },
    });
    if (sg) return { allowed: true, reason: "suggestion" };
  }

  // 6) 휴가 증빙 — 신청자, 결재자(고정·단계), 신청자 지점의 원장
  const leaves = await prisma.leaveRequest.findMany({
    where: { attachmentUrl: { in: urls } },
    select: {
      userId: true, approverId: true,
      user: { select: { branch: true } },
      approvalSteps: { select: { approverId: true } },
    },
    take: 5,
  });
  if (leaves.length) {
    let myBranches: string[] | null = null;
    for (const l of leaves) {
      if (l.userId === viewer.userId || l.approverId === viewer.userId) return { allowed: true, reason: "leave" };
      if (l.approvalSteps.some((s) => s.approverId === viewer.userId)) return { allowed: true, reason: "leave" };
      if (viewer.role === "MANAGER" && l.user.branch) {
        myBranches ??= await getManagerBranches(viewer.userId);
        if (myBranches.includes(l.user.branch)) return { allowed: true, reason: "leave" };
      }
    }
  }

  // 7) 회의 녹화 — 녹화한 사람
  const rec = await prisma.workMeetingRecording.findFirst({ where: { fileUrl: { in: urls }, createdBy: viewer.userId }, select: { id: true } });
  if (rec) return { allowed: true, reason: "recording" };

  // (봇 브리핑 카드뉴스는 보내기 전엔 본부만, 보낸 뒤엔 채팅 메시지로 1번에서 잡힌다)
  return { allowed: false, reason: "no-link" };
}

// ─── 판정 기억 — 채팅 화면은 같은 사진을 여러 번 부른다. 허용만 1분 기억(거부는 매번 다시 본다) ───
const ALLOW_TTL_MS = 60_000;
const gc = globalThis as unknown as { __workFileAllow?: Map<string, number> };
const allowCache: Map<string, number> = gc.__workFileAllow ?? (gc.__workFileAllow = new Map());

export async function canAccessWorkFileCached(segments: string[], viewer: WorkViewer): Promise<{ allowed: boolean; reason: string }> {
  const key = `${viewer.userId}|${segments.join("/")}`;
  const now = Date.now();
  const at = allowCache.get(key);
  if (at && now - at < ALLOW_TTL_MS) return { allowed: true, reason: "cached" };
  const r = await canAccessWorkFile(segments, viewer);
  if (r.allowed) {
    allowCache.set(key, now);
    if (allowCache.size > 20_000) for (const [k, v] of allowCache) if (now - v >= ALLOW_TTL_MS) allowCache.delete(k);
  }
  return r;
}

// ─── observe 기록 — 컨테이너를 다시 띄워도 남게 볼륨(uploads/private)에 한 줄씩 ───
const LOG_PATH = () => path.join(process.cwd(), "uploads", "private", "work-gate.log");
const LOG_MAX_BYTES = 5 * 1024 * 1024;
export async function logWorkGate(entry: Record<string, unknown>): Promise<void> {
  try {
    const p = LOG_PATH();
    const st = await fs.stat(p).catch(() => null);
    if (st && st.size > LOG_MAX_BYTES) return; // 넘치면 더 쓰지 않는다(분석용이라 앞부분이면 충분)
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.appendFile(p, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
  } catch { /* 기록 실패는 파일 서빙을 막지 않는다 */ }
}

/**
 * 요청 하나에 대한 work 파일 판정 — 세션(웹 쿠키·Bearer) 또는 티켓(?t=, 앱·외부 뷰어) 주체로.
 * observe 모드에서는 거부 판정을 기록만 하고 통과시킨다. 반환값 block 이 true 일 때만 막는다.
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
  let viewer: WorkViewer | null = null;
  if (opts.session) viewer = { userId: opts.session.userId, role: opts.session.role };
  else if (opts.ticketSubject) {
    // 티켓 주체(u:<id>~<세션번호>) — 재직·세션 무효화 판정은 자료제출과 같은 함수로
    const { resolveSubmissionViewer } = await import("@/lib/submission-access");
    const v = await resolveSubmissionViewer(null, opts.ticketSubject).catch(() => null);
    if (v) viewer = { userId: v.userId, role: v.role };
  }
  let status = 200;
  let reason = "";
  if (!viewer) { status = 401; reason = opts.session || opts.ticketSubject ? "inactive-or-stale-ticket" : "no-auth"; }
  else {
    const r = await canAccessWorkFileCached(opts.segments, viewer);
    if (!r.allowed) { status = 403; reason = r.reason; }
  }
  if (status === 200) return { block: false, status, error: "" };
  void logWorkGate({
    mode, via: opts.via, status, reason, file: opts.segments.join("/"),
    user: viewer?.userId ?? null, hasSession: !!opts.session, hasTicket: !!opts.ticketSubject,
    ua: opts.userAgent.slice(0, 100),
  });
  if (mode !== "enforce") return { block: false, status: 200, error: "" };
  return { block: true, status, error: status === 401 ? "인증이 필요합니다." : "이 파일을 볼 권한이 없습니다." };
}
