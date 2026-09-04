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
  } catch (e) {
    // ⚠ 종전에는 `catch { /* 무시 */ }` 였다. 이 조회가 깨지면 **오류가 몇 건이든 영영 안 알린다**
    //   — 감시가 꺼진 것을 감시가 숨기는 꼴이다(2026-09-04 검증관 C M-8).
    issues.push(`⚠️ 미처리 오류 건수를 확인하지 못했습니다 (${e instanceof Error ? e.message : String(e)}).`);
  }

  // 앱 밖 감시(호스트 워치독)가 살아 있는지 되감시한다 (2026-09-04).
  // 워치독은 앱이 죽었을 때 메일로 알리는 **마지막 방어선**이다. 그게 조용히 멈추면
  // 앱이 죽어도 아무도 모른다 — 서로 감시해야 한 쪽이 죽어도 말이 나온다.
  // 워치독은 1분마다 이 파일에 신호를 남기고, 그 디렉터리는 컨테이너에 읽기전용으로 붙어 있다.
  try {
    const beat = process.env.WATCHDOG_BEAT_PATH || "/var/log/caddy/.watchdog-beat";
    const st = await fsp.stat(beat).catch(() => null);
    if (!st) issues.push("🟠 앱 밖 감시(워치독) 신호가 없습니다 — 서버 장애 시 메일 알림이 안 갈 수 있습니다.");
    else {
      const ageMin = Math.round((Date.now() - st.mtimeMs) / 60000);
      if (ageMin > 15) issues.push(`🟠 앱 밖 감시(워치독)가 ${ageMin}분째 멈춰 있습니다 — 서버 장애 시 메일 알림이 안 갑니다.`);
    }
  } catch (e) {
    issues.push(`⚠️ 앱 밖 감시 상태를 확인하지 못했습니다 (${e instanceof Error ? e.message : String(e)}).`);
  }

  // 완료됐는데 서명본(진본 원본)이 없는 계약을 스스로 고친다.
  // ⚠ status 만으로 "완료"를 판단하면 이 구멍이 안 보인다(검증관 A G1) — 저장본 유무로 본다.
  try {
    const { healMissingSignedDocs } = await import("@/lib/signed-doc-heal");
    const r = await healMissingSignedDocs();
    if (r.failed > 0)
      issues.push(`🔴 계약 서명본 저장 실패 ${r.failed}건 — 완료 처리됐는데 진본 원본이 없습니다(재시도도 실패). 계약 id: ${r.failedIds.join(", ")}`);
    else if (r.healed > 0)
      console.log(`[monitor] 서명본 자동 복구 ${r.healed}건`);
  } catch (e) {
    issues.push(`⚠️ 계약 서명본 점검을 하지 못했습니다 (${e instanceof Error ? e.message : String(e)}).`);
  }

  // 프록시가 본 실패 응답 (2026-09-03) — try/catch 로 처리된 오류는 systemErrorLog 에 안 남는다.
  // 감시기가 멈춘 경우도 여기서 함께 알린다("조용한 것"과 "고장난 것"을 구별해야 한다).
  try {
    const { collectFailures, describeFailures } = await import("@/lib/access-log");
    // 유형별로 받는다 — 한 문자열로 이으면 뒤에 붙은 문제가 중복 판정에 묻힌다
    issues.push(...describeFailures(await collectFailures(24)));
  } catch (e) {
    // ⚠ 점검 자체가 죽으면 안 되지만, **조용히** 죽어도 안 된다. 여기가 무음이면
    //   접근 로그 감시가 통째로 고장나도 아무도 모른다(검증관 C M-8).
    issues.push(`⚠️ 접근 로그 감시가 실패했습니다 (${e instanceof Error ? e.message : String(e)}).`);
  }

  return issues;
}

// 헬스체크 실행 + 이상 시 관리자들에게 봇 DM (이슈 유형별 하루 1회만)
export async function runHealthCheckAndAlert() {
  const issues = await runHealthCheck();
  // 14일 지난 에러 로그 자동 정리
  prisma.systemErrorLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) } } }).catch(() => {});
  if (!issues.length) return;

  const g = globalThis as unknown as { __healthAlerted?: Map<string, number> };
  // 같은 종류를 하루 1회로 묶는 키: 첫 구분자(—) 앞에서 숫자만 지운다.
  // ⚠ 종전에는 28자로 잘랐다. 그러면 "🔴 서버 오류 [### /api/contracts/" 까지만 남아
  //   **서로 다른 계약 사고가 같은 키로 24시간 묻힌다**(검증관 C 실측: 500 bundle-preview /
  //   500 sign / 404 bundle-preview 세 건의 키가 전부 동일). 경로를 키에 담으라고 넣어 놓고
  //   다시 잘라내면 의미가 없다 — 자르지 않는다.
  //   숫자를 지우는 이유는 "디스크 91%" 와 "92%" 를 같은 사고로 보기 위함인데, 그러면
  //   **상태코드까지 지워져 500 과 404 가 같은 키가 된다.** 대괄호 안(어느 경로가 터졌는가)은
  //   그대로 두고 밖의 숫자만 지운다.
  const keyOf = (s: string) =>
    s.split("—")[0].replace(/\[[^\]]*\]|[0-9]+/g, (m) => (m[0] === "[" ? m : "#")).trim().slice(0, 120);
  const alerted = g.__healthAlerted ?? (g.__healthAlerted = new Map());
  const fresh = issues.filter((i) => {
    // ⚠ 숫자를 지우고 유형을 본다. 종전에는 앞 20자를 그대로 써서 "디스크 사용률 91%" 처럼
    //   건수가 바뀌면 매번 새 알림으로 보였고, 매시 정각 점검마다 DM 이 갔다(2026-09-03 지적).
    // ⚠ 문장 전체를 키로 쓰면 **문제와 무관한 문구**까지 키에 들어간다.
    //   "최근 5시간(로그가 그만큼…)" ↔ "최근 4.8시간…" ↔ "로그에 남은 구간" 처럼
    //   로그 회전 상태에 따라 같은 5xx 하나가 네 가지 키를 만들어 하루에 여러 번 갔다
    //   (2026-09-04 검증 지적). 유형만 남기려고 첫 구분자 앞까지만, 숫자는 지운다.
    const key = keyOf(i);
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
  const sendErrors: string[] = [];
  for (const id of targets) {
    try { await botSendDM(id, text); sent++; }
    catch (e) { sendErrors.push(e instanceof Error ? e.message : String(e)); } // 한 명 실패가 나머지를 막지 않게
  }
  // ⚠ 아무에게도 못 보냈으면 그 사실이 어딘가에는 남아야 한다. 종전에는 통째로 무음이라
  //   "알림이 안 온다 = 문제가 없다" 로 보이는 최악의 상태였다(검증관 C M-8).
  if (sent === 0 && targets.length > 0) {
    console.error(`[monitor] 점검 알림을 아무에게도 보내지 못했습니다 (대상 ${targets.length}명): ${sendErrors.join(" | ")}`);
    try {
      await prisma.systemErrorLog.create({
        data: { path: "/monitor (점검 알림 발송)", method: "BOT",
                message: `점검 알림 발송 실패 — 대상 ${targets.length}명 전원 실패: ${sendErrors.slice(0, 3).join(" | ")}` },
      });
    } catch { /* DB 가 죽어 있으면 여기까지다 — 앱 밖 감시(호스트 워치독)가 받는다 */ }
  }
  // 한 명이라도 실제로 받았을 때만 "알렸다"로 친다. 아무도 못 받았으면 다음 점검에서 다시 시도한다.
  if (sent > 0) for (const it of fresh) alerted.set(keyOf(it), Date.now());
}
