import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { workFileDiskPath } from "@/lib/work-file";

/**
 * 운영 모니터링 — 에러 로그 기록, 디스크/DB 헬스체크, 저장공간 집계
 */

// API 오류를 DB에 기록 (실패해도 본 요청에 영향 없게 조용히)
// 알려진 무해·일시 오류 패턴 — 기록은 남기되 자동으로 처리완료 표시 (봇 알림·미처리 목록에서 제외)
// "Expected RSC response": 재배포 직후, 배포 전에 열어둔 브라우저 화면이 새 서버와 버전이 안 맞아
// 나는 Next.js 일시 오류. 사용자가 새로고침하면 사라지며 코드 결함이 아님.
const KNOWN_TRANSIENT_PATTERNS = ["Expected RSC response"];

export async function logSystemError(entry: {
  path: string;
  method?: string | null;
  userName?: string | null;
  message: string;
  stack?: string | null;
}) {
  try {
    const transient = KNOWN_TRANSIENT_PATTERNS.some((p) => entry.message.includes(p));
    await prisma.systemErrorLog.create({
      data: {
        path: entry.path.slice(0, 300),
        method: entry.method ?? null,
        userName: entry.userName ?? null,
        message: entry.message.slice(0, 2000),
        stack: entry.stack ? entry.stack.slice(0, 8000) : null,
        ...(transient
          ? { resolved: true, resolvedBy: "자동(배포 직후 일시 오류)", resolvedAt: new Date() }
          : {}),
      },
    });
  } catch {
    // 로그 기록 실패는 무시 (콘솔에는 이미 남음)
  }
}

// 디스크 사용률 (컨테이너의 / 는 호스트 오버레이 디스크를 반영)
export function getDiskUsage(): { totalGb: number; usedGb: number; percent: number } {
  const s = fs.statfsSync("/");
  const total = s.blocks * s.bsize;
  const free = s.bavail * s.bsize;
  const used = total - free;
  return {
    totalGb: Math.round((total / 1024 ** 3) * 10) / 10,
    usedGb: Math.round((used / 1024 ** 3) * 10) / 10,
    percent: Math.round((used / total) * 100),
  };
}

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

// fileUrl("/api/uploads/...") → 디스크 경로
function uploadPathFromUrl(fileUrl: string): string | null {
  // 채팅 첨부 경로는 lib/work-file 한 곳에서만 만든다 — 종전 구현은 ".." 검사를 디코드
  // **전에** 해서 %2e%2e 가 그대로 통과했다. 이 함수는 첨부 정리(파일 삭제)에도 쓰이므로
  // 뚫리면 임의 파일 삭제가 된다.
  return workFileDiskPath(fileUrl);
}

async function fileSize(url: string): Promise<number> {
  const p = uploadPathFromUrl(url);
  if (!p) return 0;
  try { return (await fsp.stat(p)).size; } catch { return 0; }
}

export type ChannelStorage = {
  channelId: string;
  channelName: string;
  type: string;
  files: number;
  bytes: number;
  images: number;
  videos: number;
  others: number;
};

// 채팅방별 첨부 용량 집계 (파일 실측 크기)
export async function collectStorageStats(): Promise<{
  disk: { totalGb: number; usedGb: number; percent: number };
  uploadsBytes: number;
  channels: ChannelStorage[];
}> {
  const messages = await prisma.workMessage.findMany({
    where: { deletedAt: null, OR: [{ fileUrl: { not: null } }, { albumUrls: { not: { equals: null } } }] },
    select: {
      channelId: true,
      fileUrl: true,
      fileType: true,
      albumUrls: true,
      channel: { select: { name: true, type: true, deletedAt: true } },
    },
  });

  const map = new Map<string, ChannelStorage>();
  let uploadsBytes = 0;
  for (const m of messages) {
    if (m.channel.deletedAt) continue;
    let entry = map.get(m.channelId);
    if (!entry) {
      entry = {
        channelId: m.channelId,
        channelName: m.channel.type === "DM" ? "(1:1 대화)" : m.channel.name,
        type: m.channel.type,
        files: 0, bytes: 0, images: 0, videos: 0, others: 0,
      };
      map.set(m.channelId, entry);
    }
    const urls: { url: string; kind: "image" | "video" | "other" }[] = [];
    if (m.fileUrl) {
      urls.push({ url: m.fileUrl, kind: m.fileType === "image" ? "image" : m.fileType === "video" ? "video" : "other" });
    }
    if (Array.isArray(m.albumUrls)) {
      for (const u of m.albumUrls as string[]) urls.push({ url: u, kind: "image" });
    }
    for (const u of urls) {
      const size = await fileSize(u.url);
      entry.files++;
      entry.bytes += size;
      uploadsBytes += size;
      if (u.kind === "image") entry.images++;
      else if (u.kind === "video") entry.videos++;
      else entry.others++;
    }
  }

  const channels = [...map.values()].sort((a, b) => b.bytes - a.bytes);
  return { disk: getDiskUsage(), uploadsBytes, channels };
}

// 채널의 오래된 첨부 정리 — 파일 삭제 + 메시지에서 첨부 제거 (대화 내용은 유지)
export async function cleanupChannelAttachments(channelId: string, olderThanDays: number): Promise<{ removedFiles: number; freedBytes: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const messages = await prisma.workMessage.findMany({
    where: {
      channelId,
      createdAt: { lt: cutoff },
      OR: [{ fileUrl: { not: null } }, { NOT: { albumUrls: { equals: Prisma.AnyNull } } }],
    },
    select: { id: true, content: true, fileUrl: true, albumUrls: true },
  });

  let removedFiles = 0;
  let freedBytes = 0;
  for (const m of messages) {
    const urls: string[] = [];
    if (m.fileUrl) urls.push(m.fileUrl);
    if (Array.isArray(m.albumUrls)) urls.push(...(m.albumUrls as string[]));
    for (const u of urls) {
      const p = uploadPathFromUrl(u);
      if (!p) continue;
      try {
        const st = await fsp.stat(p);
        await fsp.unlink(p);
        removedFiles++;
        freedBytes += st.size;
      } catch { /* 이미 없으면 무시 */ }
    }
    await prisma.workMessage.update({
      where: { id: m.id },
      data: {
        fileUrl: null,
        fileName: null,
        fileType: null,
        albumUrls: Prisma.DbNull,
        content: m.content?.trim() ? m.content : "(보관기간 만료로 첨부파일이 정리되었습니다)",
      },
    });
  }
  return { removedFiles, freedBytes };
}

// 헬스체크 — 이상 항목 목록 반환 (없으면 빈 배열)
export async function runHealthCheck(): Promise<string[]> {
  const issues: string[] = [];

  // 디스크
  try {
    const disk = getDiskUsage();
    if (disk.percent >= 90) issues.push(`🔴 디스크 사용률 ${disk.percent}% (${disk.usedGb}/${disk.totalGb}GB) — 즉시 정리가 필요합니다.`);
    else if (disk.percent >= 80) issues.push(`🟠 디스크 사용률 ${disk.percent}% (${disk.usedGb}/${disk.totalGb}GB) — 저장공간 정리를 권장합니다.`);
  } catch { issues.push("⚠️ 디스크 상태를 확인하지 못했습니다."); }

  // DB 응답
  try {
    const t = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const ms = Date.now() - t;
    if (ms > 2000) issues.push(`🟠 DB 응답 지연 (${ms}ms)`);
  } catch { issues.push("🔴 DB 응답 실패 — 데이터베이스 상태를 확인하세요."); }

  // 최근 24시간 미처리 오류 수 (처리완료·자동처리된 건은 알림 대상에서 제외)
  try {
    const count = await prisma.systemErrorLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, resolved: false },
    });
    if (count >= 20) issues.push(`🟠 최근 24시간 미처리 서버 오류 ${count}건 — 시스템 로그를 확인하세요.`);
  } catch { /* 무시 */ }

  // 프록시가 본 실패 응답 (2026-09-03) — try/catch 로 처리된 오류는 systemErrorLog 에 안 남는다.
  // 감시기가 멈춘 경우도 여기서 함께 알린다("조용한 것"과 "고장난 것"을 구별해야 한다).
  try {
    const { collectFailures, describeFailures } = await import("@/lib/access-log");
    // 유형별로 받는다 — 한 문자열로 이으면 뒤에 붙은 문제가 중복 판정에 묻힌다
    issues.push(...describeFailures(await collectFailures(24)));
  } catch { /* 감시 때문에 점검 자체가 죽으면 안 된다 */ }

  return issues;
}

// 헬스체크 실행 + 이상 시 관리자들에게 봇 DM (이슈 유형별 하루 1회만)
export async function runHealthCheckAndAlert() {
  const issues = await runHealthCheck();
  // 14일 지난 에러 로그 자동 정리
  prisma.systemErrorLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } } }).catch(() => {});
  if (!issues.length) return;

  const g = globalThis as unknown as { __healthAlerted?: Map<string, number> };
  const alerted = g.__healthAlerted ?? (g.__healthAlerted = new Map());
  const fresh = issues.filter((i) => {
    // ⚠ 숫자를 지우고 유형을 본다. 종전에는 앞 20자를 그대로 써서 "디스크 사용률 91%" 처럼
    //   건수가 바뀌면 매번 새 알림으로 보였고, 매시 정각 점검마다 DM 이 갔다(2026-09-03 지적).
    const key = i.replace(/[0-9]+/g, "#").slice(0, 28);
    // ⚠ 여기서 곧바로 "보냈다"고 기록하면 안 된다. botSendDM 은 DB 에 메시지를 만드는 방식이라
    //   DB 장애 중에는 조용히 실패하는데, 그러면 정작 "DB 응답 실패" 알림이 아무에게도 안 간 채
    //   24시간 잠긴다(2026-09-03 지적). **발송에 성공한 뒤에** 기록한다.
    return Date.now() - (alerted.get(key) || 0) >= 24 * 60 * 60 * 1000;
  });
  if (!fresh.length) return;

  // 관리자 전원이 아니라 **지정된 담당자**에게만 (2026-09-03 디렉터 지시).
  // 관리자 화면 > 봇 설정에서 고른다. 아무도 안 고르면 전원으로 되돌아간다(조용해지면 안 된다).
  const { getNotifyRecipients } = await import("@/lib/notify-targets");
  const targets = await getNotifyRecipients("system");
  const { botSendDM } = await import("@/lib/bot");
  const text = `🩺 시스템 점검 알림\n${fresh.join("\n")}\n\n관리자 페이지 > 저장공간/시스템 로그에서 자세히 확인할 수 있습니다.`;
  let sent = 0;
  for (const id of targets) {
    try { await botSendDM(id, text); sent++; } catch { /* 한 명 실패가 나머지를 막지 않게 */ }
  }
  // 한 명이라도 실제로 받았을 때만 "알렸다"로 친다. 아무도 못 받았으면 다음 점검에서 다시 시도한다.
  if (sent > 0) for (const it of fresh) alerted.set(it.replace(/[0-9]+/g, "#").slice(0, 28), Date.now());
}
