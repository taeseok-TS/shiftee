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
import type { Alert } from "@/lib/access-log";

/**
 * 점검 결과. `heal` 을 켜면 계약 서명본 자가복구까지 한다.
 *
 * ⚠ 기본값은 **끔**이다. runHealthCheck 는 `GET /api/admin/storage` 에서도 불리는데,
 *   거기서 자가복구가 돌면 **GET 이 상태를 바꾼다**. Caddy 는 배포 중 GET 을 재시도하므로
 *   (무중단 전환) 문서 재생성이 조용히 두 번 실행된다 — Caddyfile 이 바로 그걸 경고하고
 *   있다(2026-09-04 검증관 B F5). 자가복구는 봇 점검에서만 켠다.
 */
/**
 * 점검이 **실제로 확인한 값**. 일일 보고에서 "무엇을 봤는지"를 보여주는 데 쓴다.
 * 문제만 돌려주면 "이상 없음"이 무엇을 근거로 한 말인지 알 수 없다.
 * null = 확인하지 못했거나 이 인스턴스에서 끈 항목.
 */
export type HealthFacts = {
  diskPercent: number | null; diskUsedGb: number | null; diskTotalGb: number | null;
  dbMs: number | null;
  unresolvedErrors: number | null;
  watchdogAgeMin: number | null;   // null = WATCHDOG_BEAT_PATH 미설정(안 깐 인스턴스)
  beatAgeMin: number | null;       // 앱 하트비트
  server24h: number | null; client24h: number | null; coveredHours: number | null;
};

export async function runHealthCheck(opts?: { heal?: boolean }): Promise<{ issues: Alert[]; facts: HealthFacts }> {
  const issues: Alert[] = [];
  const facts: HealthFacts = {
    diskPercent: null, diskUsedGb: null, diskTotalGb: null, dbMs: null,
    unresolvedErrors: null, watchdogAgeMin: null, beatAgeMin: null,
    server24h: null, client24h: null, coveredHours: null,
  };

  // 디스크
  try {
    const disk = getDiskUsage();
    facts.diskPercent = disk.percent; facts.diskUsedGb = disk.usedGb; facts.diskTotalGb = disk.totalGb;
    if (disk.percent >= 90) issues.push({ text: `🔴 디스크 사용률 ${disk.percent}% (${disk.usedGb}/${disk.totalGb}GB) — 즉시 정리가 필요합니다.`, keys: ["disk"] });
    else if (disk.percent >= 80) issues.push({ text: `🟠 디스크 사용률 ${disk.percent}% (${disk.usedGb}/${disk.totalGb}GB) — 저장공간 정리를 권장합니다.`, keys: ["disk"] });
  } catch { issues.push({ text: "⚠️ 디스크 상태를 확인하지 못했습니다.", keys: ["diskUnknown"] }); }

  // DB 응답
  try {
    const t = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const ms = Date.now() - t;
    facts.dbMs = ms;
    if (ms > 2000) issues.push({ text: `🟠 DB 응답 지연 (${ms}ms)`, keys: ["dbSlow"] });
  } catch { issues.push({ text: "🔴 DB 응답 실패 — 데이터베이스 상태를 확인하세요.", keys: ["dbDown"] }); }

  // 최근 24시간 미처리 오류 수 (처리완료·자동처리된 건은 알림 대상에서 제외)
  try {
    const count = await prisma.systemErrorLog.count({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, resolved: false },
    });
    facts.unresolvedErrors = count;
    if (count >= 20) issues.push({ text: `🟠 최근 24시간 미처리 서버 오류 ${count}건 — 시스템 로그를 확인하세요.`, keys: ["unresolved"] });
  } catch (e) {
    // ⚠ 종전에는 `catch { /* 무시 */ }` 였다. 이 조회가 깨지면 **오류가 몇 건이든 영영 안 알린다**
    //   — 감시가 꺼진 것을 감시가 숨기는 꼴이다(2026-09-04 검증관 C M-8).
    issues.push({ text: `⚠️ 미처리 오류 건수를 확인하지 못했습니다 (${e instanceof Error ? e.message : String(e)}).`, keys: ["unresolvedUnknown"] });
  }

  // 앱 밖 감시(호스트 워치독)가 살아 있는지 되감시한다 (2026-09-04).
  // 워치독은 앱이 죽었을 때 메일로 알리는 **마지막 방어선**이다. 그게 조용히 멈추면
  // 앱이 죽어도 아무도 모른다 — 서로 감시해야 한 쪽이 죽어도 말이 나온다.
  // 워치독은 1분마다 이 파일에 신호를 남기고, 그 디렉터리는 컨테이너에 읽기전용으로 붙어 있다.
  // ⚠ **켠 곳에서만** 본다. 종전에는 경로가 없으면 하드코딩 폴백으로 무조건 검사해,
  //   워치독을 안 깐 판매용 인스턴스가 매일 오탐을 냈다(2026-09-04 검증관 A M-3).
  //   접근 로그 감시가 ACCESS_LOG_PATH 미설정이면 조용히 꺼지는 것과 같은 규칙이다.
  if (process.env.WATCHDOG_BEAT_PATH) try {
    const beat = process.env.WATCHDOG_BEAT_PATH;
    const st = await fsp.stat(beat).catch(() => null);
    if (!st) issues.push({ text: "🟠 앱 밖 감시(워치독) 신호가 없습니다 — 서버 장애 시 메일 알림이 안 갈 수 있습니다.", keys: ["watchdogMissing"] });
    else {
      const ageMin = Math.round((Date.now() - st.mtimeMs) / 60000);
      facts.watchdogAgeMin = ageMin;
      if (ageMin > 15) issues.push({ text: `🟠 앱 밖 감시(워치독)가 ${ageMin}분째 멈춰 있습니다 — 서버 장애 시 메일 알림이 안 갑니다.`, keys: ["watchdogStale"] });
    }
  } catch (e) {
    issues.push({ text: `⚠️ 앱 밖 감시 상태를 확인하지 못했습니다 (${e instanceof Error ? e.message : String(e)}).`, keys: ["watchdogUnknown"] });
  }

  // 완료됐는데 서명본(진본 원본)이 없는 계약을 스스로 고친다. **봇 점검에서만** 돈다(F5).
  // ⚠ status 만으로 "완료"를 판단하면 이 구멍이 안 보인다(검증관 A G1) — 저장본 유무로 본다.
  if (opts?.heal) try {
    const { healMissingSignedDocs } = await import("@/lib/signed-doc-heal");
    const r = await healMissingSignedDocs();
    if (r.failed > 0)
      issues.push({
        text: `🔴 계약 서명본 없음 ${r.backlog}건 — 완료 처리됐는데 진본 원본이 없습니다`
          + `(이번에 ${r.checked}건 재시도, ${r.healed}건 복구, ${r.failed}건 실패).`
          + ` 계약 id: ${r.failedIds.slice(0, 5).join(", ")}${r.failedIds.length > 5 ? " 외" : ""}`,
        keys: ["signedDocFail"],
      });
    else if (r.healed > 0)
      console.log(`[monitor] 서명본 자동 복구 ${r.healed}건`);
    // 완료본 고정(#205-5) — 실패만 알린다(백필 진행은 로그로)
    if (r.freezeFailed > 0)
      issues.push({
        text: `🟠 완료본 고정(문서번호·SHA-256) 실패 ${r.freezeFailed}건 — 아직 고정 안 된 완료 계약 ${r.freezeBacklog}건.`
          + ` 계약 id: ${r.freezeFailedIds.slice(0, 5).join(", ")}${r.freezeFailedIds.length > 5 ? " 외" : ""}`,
        keys: ["signedFreezeFail"],
      });
    if (r.frozen > 0) console.log(`[monitor] 완료본 고정 ${r.frozen}건(남은 ${r.freezeBacklog}건)`);
    // 제3자 시각 도장(TSA) — 무료 공개 서비스라 가끔 실패한다. 실패가 있으면 알린다(유형별 하루 1회)
    if (r.stampFailed > 0)
      issues.push({ text: `🟡 제3자 시각 인증(TSA) 실패 ${r.stampFailed}건 — 도장 없는 완료본 ${r.stampBacklog}건(다음 시간에 다시 시도).`, keys: ["tsaFail"] });
    if (r.stamped > 0) console.log(`[monitor] 시각 도장 ${r.stamped}건(남은 ${r.stampBacklog}건)`);
  } catch (e) {
    issues.push({ text: `⚠️ 계약 서명본 점검을 하지 못했습니다 (${e instanceof Error ? e.message : String(e)}).`, keys: ["signedDocUnknown"] });
  }

  // 프록시가 본 실패 응답 (2026-09-03) — try/catch 로 처리된 오류는 systemErrorLog 에 안 남는다.
  // 감시기가 멈춘 경우도 여기서 함께 알린다("조용한 것"과 "고장난 것"을 구별해야 한다).
  try {
    const { collectFailures, describeFailures } = await import("@/lib/access-log");
    const f = await collectFailures(24);
    if (f && !f.unavailable) {
      facts.server24h = f.server; facts.client24h = f.client; facts.coveredHours = f.coveredHours;
      facts.beatAgeMin = f.lastBeatAt ? Math.round((Date.now() - f.lastBeatAt.getTime()) / 60000) : null;
    }
    // 유형별로 받는다 — 한 문자열로 이으면 뒤에 붙은 문제가 중복 판정에 묻힌다
    issues.push(...describeFailures(f));
  } catch (e) {
    // ⚠ 점검 자체가 죽으면 안 되지만, **조용히** 죽어도 안 된다. 여기가 무음이면
    //   접근 로그 감시가 통째로 고장나도 아무도 모른다(검증관 C M-8).
    issues.push({ text: `⚠️ 접근 로그 감시가 실패했습니다 (${e instanceof Error ? e.message : String(e)}).`, keys: ["accessLogFail"] });
  }

  return { issues, facts };
}

// 헬스체크 실행 + 이상 시 관리자들에게 봇 DM (유형별 하루 1회만)
//
// ⚠ 중복 방지 기록을 종전에는 `globalThis` Map 에 뒀다. 그러면 **배포할 때마다 초기화**되어
//   같은 알림이 하루에도 여러 번 갔다(2026-09-04 검증관 A M-2 / C C-7). 프로세스 밖(DB)에 남긴다.
// ⚠ 판정 기준도 문장이 아니라 **키 집합**이다. 문장에는 상위 경로가 섞여 있어 창이 미끄러지면
//   같은 사고가 새 알림이 됐고, 반대로 외부 스캐너가 상위를 점거하면 진짜 사고가 묻혔다.
//   "24시간 안에 처음 보는 키가 하나라도 있으면 알린다"로 바꾼다.
const ALERT_STATE_KEY = "healthAlertedKeys";
const DAY_MS = 24 * 60 * 60 * 1000;

async function loadAlerted(): Promise<Record<string, number>> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: ALERT_STATE_KEY } });
    const v = row?.value ? JSON.parse(row.value) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, number>) : {};
  } catch {
    return {}; // 읽기 실패는 "처음 본다"로 친다 — 조용해지느니 한 번 더 알리는 쪽이 낫다
  }
}

async function saveAlerted(map: Record<string, number>): Promise<void> {
  // 오래된 항목은 버린다(무한 증가 방지 — 키를 외부에서 만들 수 있으므로 상한이 필요하다)
  const cut = Date.now() - 2 * DAY_MS;
  const pruned = Object.fromEntries(Object.entries(map).filter(([, t]) => t > cut).slice(-500));
  const value = JSON.stringify(pruned);
  try {
    await prisma.appSetting.upsert({
      where: { key: ALERT_STATE_KEY },
      create: { key: ALERT_STATE_KEY, value },
      update: { value },
    });
  } catch (e) {
    console.error("[monitor] 알림 중복방지 기록 저장 실패:", e);
  }
}

/**
 * 일일 상태 보고 — **이상이 없어도** 하루 한 번 보낸다 (2026-09-06 디렉터 지시).
 *
 * 왜 필요한가: 알림을 좁히고 나니 조용한 게 정상이 됐는데, 그러면 **감시가 죽어서 조용한
 * 것인지 구별할 방법이 없다**. 하루 한 번 오는 이 보고 자체가 "감시가 살아 있다"는 증거다.
 * 안 오면 그게 신호다.
 *
 * 매시 알림(runHealthCheckAndAlert)과 역할이 다르다:
 *   · 매시 알림 = 문제가 생겼을 때, 유형별 하루 1회 (중복 방지 있음)
 *   · 일일 보고 = 매일 같은 시각, 있든 없든 (중복 방지 **없음** — 그게 요점이다)
 * 그래서 문제가 계속되면 매일 보고에 계속 실린다. 그건 소음이 아니라 현황이다.
 *
 * 자가복구(heal)는 여기서 돌리지 않는다 — 매시 점검이 이미 한다.
 */
export async function runDailyHealthReport() {
  const { issues, facts } = await runHealthCheck({ heal: false });

  const ok = (v: unknown) => v !== null && v !== undefined;
  const lines: string[] = [];
  lines.push(ok(facts.dbMs) ? `· 서버·DB 정상 (DB 응답 ${facts.dbMs}ms)` : "· DB 응답을 확인하지 못했습니다");
  if (ok(facts.diskPercent))
    lines.push(`· 디스크 ${facts.diskPercent}% 사용 (${facts.diskUsedGb}/${facts.diskTotalGb}GB)`);
  if (ok(facts.server24h))
    lines.push(`· 최근 ${facts.coveredHours}시간 서버 오류 ${facts.server24h}건 / 우리 API 실패 ${facts.client24h}건`);
  if (ok(facts.unresolvedErrors))
    lines.push(`· 미처리 오류 로그 ${facts.unresolvedErrors}건`);
  if (ok(facts.beatAgeMin)) lines.push(`· 앱 하트비트 ${facts.beatAgeMin}분 전`);
  if (ok(facts.watchdogAgeMin)) lines.push(`· 앱 밖 감시(워치독) ${facts.watchdogAgeMin}분 전`);

  // 한국시간 기준 날짜. 컨테이너 TZ 가 UTC 라 그냥 getMonth() 를 쓰면 자정 부근에 하루가 어긋난다.
  const k = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const day = `${k.getUTCMonth() + 1}/${k.getUTCDate()}`;
  const head = issues.length === 0
    ? `✅ 큐브티 이상 없음 (${day})`
    : `🩺 큐브티 일일 점검 (${day}) — 확인 필요 ${issues.length}건`;
  const body = issues.length === 0 ? "" : "\n" + "\n" + issues.map((i) => i.text).join("\n");
  const text = head + "\n" + "\n" + lines.join("\n") + body
    + "\n" + "\n" + "문제가 생기면 이 시각과 무관하게 바로 알려드립니다.";

  const { getNotifyRecipients } = await import("@/lib/notify-targets");
  const targets = await getNotifyRecipients("system");
  const { botSendDM } = await import("@/lib/bot");
  let sent = 0;
  for (const id of targets) {
    try { await botSendDM(id, text); sent++; } catch { /* 한 명 실패가 나머지를 막지 않게 */ }
  }
  // ⚠ 이 보고가 안 가면 "감시가 살아 있다"는 증거가 사라진다. 실패를 조용히 넘기지 않는다.
  if (sent === 0 && targets.length > 0) {
    console.error(`[monitor] 일일 상태 보고를 아무에게도 보내지 못했습니다 (대상 ${targets.length}명)`);
    try {
      await prisma.systemErrorLog.create({
        data: { path: "/monitor (일일 상태 보고)", method: "BOT",
                message: `일일 상태 보고 발송 실패 — 대상 ${targets.length}명 전원 실패` },
      });
    } catch { /* DB 가 죽어 있으면 여기까지다 — 워치독 메일이 받는다 */ }
  }
  return { sent, issues: issues.length };
}

export async function runHealthCheckAndAlert() {
  const { issues } = await runHealthCheck({ heal: true });
  // 14일 지난 에러 로그 자동 정리
  prisma.systemErrorLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 14 * DAY_MS) } } }).catch(() => {});
  if (!issues.length) return;

  const alerted = await loadAlerted();
  const now = Date.now();
  // 키가 하나라도 "24시간 안에 본 적 없는 것"이면 새 사고로 본다.
  const fresh = issues.filter((it) => it.keys.some((k) => now - (alerted[k] || 0) >= DAY_MS));
  if (!fresh.length) return;

  // 관리자 전원이 아니라 **지정된 담당자**에게만 (2026-09-03 디렉터 지시).
  // 관리자 화면 > 봇 설정에서 고른다. 아무도 안 고르면 전원으로 되돌아간다(조용해지면 안 된다).
  const { getNotifyRecipients } = await import("@/lib/notify-targets");
  const targets = await getNotifyRecipients("system");
  const { botSendDM } = await import("@/lib/bot");
  const text = "🩺 시스템 점검 알림\n" + fresh.map((f) => f.text).join("\n")
    + "\n\n관리자 페이지 > 저장공간/시스템 로그에서 자세히 확인할 수 있습니다.";
  let sent = 0;
  const sendErrors: string[] = [];
  for (const id of targets) {
    try { await botSendDM(id, text); sent++; }
    catch (e) { sendErrors.push(e instanceof Error ? e.message : String(e)); } // 한 명 실패가 나머지를 막지 않게
  }
  // ⚠ 여기서 곧바로 "보냈다"고 기록하면 안 된다. botSendDM 은 DB 에 메시지를 만드는 방식이라
  //   DB 장애 중에는 조용히 실패하는데, 그러면 정작 "DB 응답 실패" 알림이 아무에게도 안 간 채
  //   24시간 잠긴다(2026-09-03 지적). **한 명이라도 실제로 받았을 때만** 기록한다.
  if (sent > 0) {
    for (const it of fresh) for (const k of it.keys) alerted[k] = now;
    await saveAlerted(alerted);
    return;
  }
  // ⚠ 아무에게도 못 보냈으면 그 사실이 어딘가에는 남아야 한다. 종전에는 통째로 무음이라
  //   "알림이 안 온다 = 문제가 없다" 로 보이는 최악의 상태였다(검증관 C M-8).
  if (targets.length > 0) {
    console.error(`[monitor] 점검 알림을 아무에게도 보내지 못했습니다 (대상 ${targets.length}명): ${sendErrors.join(" | ")}`);
    try {
      await prisma.systemErrorLog.create({
        data: { path: "/monitor (점검 알림 발송)", method: "BOT",
                message: `점검 알림 발송 실패 — 대상 ${targets.length}명 전원 실패: ${sendErrors.slice(0, 3).join(" | ")}` },
      });
    } catch { /* DB 가 죽어 있으면 여기까지다 — 앱 밖 감시(워치독 메일)가 받는다 */ }
  }
}
