import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";

export type WorkAttachment = { fileUrl: string; fileName: string; fileType: string };
export type StoredAttachment = WorkAttachment & { owned: boolean };

// 예약 한 건에 담을 수 있는 첨부 수. 즉시 전송에는 총량 상한이 없지만(앨범만 10장),
// 예약은 파일을 미리 올려두는 구조라 무한정 받으면 디스크가 인질이 된다.
export const MAX_SCHEDULED_ATTACHMENTS = 20;

// 채팅 첨부 주소 검증 — 클라이언트가 주는 값이라 그대로 믿으면 안 된다.
// 계약서·서명·직인 경로를 넣어두고 첨부로 빼내는 우회가 있었다(2026-09-02). work 군만 허용한다.
/** 주소 정규화 — 쿼리(?…)를 뗀 값 하나로만 다룬다.
 *  ⚠ 비교는 원문으로, 삭제는 쿼리를 뗀 경로로 하면 `?x` 한 글자로 "쓰이는 중" 검사가 통째로 비켜간다
 *  (2026-09-16 검증관: 직원 누구나 남의 첨부를 영구 삭제할 수 있었다). */
export const bareUrl = (u: string) => u.split("?")[0];

export function okWorkAttachUrl(u: unknown): u is string {
  return (
    typeof u === "string" &&
    u.startsWith("/api/uploads/work/") &&
    !u.includes("..") &&
    !u.includes("\\") &&
    u.split("?")[0].split("/").length === 5
  );
}

// 첨부 목록 정규화. ⚠ owned(서버가 판단하는 소유 표시)는 **여기서 절대 읽지 않는다** —
// 클라이언트 입력에도 같은 함수를 쓰므로, 읽으면 남이 owned:true 를 적어 보낼 수 있다.
export function parseAttachments(raw: unknown): WorkAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const { fileUrl, fileName, fileType } = a as Record<string, unknown>;
    if (!okWorkAttachUrl(fileUrl)) continue;
    out.push({
      fileUrl: bareUrl(fileUrl), // 같은 파일이 두 모양(?x)으로 남지 않게 — 위 주석 참고
      fileName: typeof fileName === "string" && fileName.trim() ? fileName.slice(0, 255) : "file",
      fileType:
        fileType === "image" || fileType === "video" || fileType === "audio" ? fileType : "file",
    });
    if (out.length >= MAX_SCHEDULED_ATTACHMENTS) break;
  }
  return out;
}

// DB 에 저장된 첨부를 읽는다 (owned 포함). 저장할 때 서버가 찍은 값만 신뢰한다.
export function readAttachments(raw: unknown): StoredAttachment[] {
  const arr = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return parseAttachments(raw).map((a) => {
    const src = arr.find((x) => x && typeof x === "object" && x.fileUrl === a.fileUrl);
    return { ...a, owned: src?.owned === true };
  });
}

// 이 파일을 이미 누가 쓰고 있나.
// ⚠ 앨범(사진 2장 이상) 사진은 fileUrl 이 아니라 albumUrls 배열에만 들어간다 —
//   fileUrl 만 보면 **남의 앨범 사진을 지울 수 있다**(2026-09-16 검증관 C-1). 대기 중인 다른 예약도 본다.
export async function isFileReferenced(rawUrl: string, exceptScheduledId?: string) {
  const url = bareUrl(rawUrl);
  const msg = await prisma.workMessage.findFirst({
    where: { OR: [{ fileUrl: url }, { albumUrls: { array_contains: [url] } }] },
    select: { id: true },
  });
  if (msg) return true;
  const pending = await prisma.workScheduledMessage.findMany({
    where: {
      sentAt: null,
      canceledAt: null,
      ...(exceptScheduledId ? { id: { not: exceptScheduledId } } : {}),
    },
    select: { attachments: true },
  });
  if (pending.some((r) => parseAttachments(r.attachments).some((a) => a.fileUrl === url))) return true;
  // 같은 uploads/work 파일은 채팅 말고도 **관리자 브리핑 첨부**(아직 발송 안 된 12개월치 카드뉴스)와
  // **공지 첨부** 로도 참조된다. 메시지가 아직 없으니 소유로 찍혀 통째로 지울 수 있었다(검증관 1-c).
  const asBrief = JSON.stringify([{ url }]);
  const [brief, notice] = await Promise.all([
    prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one FROM "BotBriefing" WHERE "attachments" @> ${asBrief}::jsonb LIMIT 1`,
    prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one FROM "WorkAnnouncement" WHERE position(${url} in "attachments") > 0 LIMIT 1`,
  ]);
  return brief.length > 0 || notice.length > 0;
}

// 예약 등록 시점에 "이 예약이 데려온 새 파일"만 소유로 표시한다.
// 이미 어딘가에서 쓰이는 URL(남의 사진, 전달된 파일)은 소유가 아니므로 취소해도 지우지 않는다.
export async function markOwnedAttachments(files: WorkAttachment[]): Promise<StoredAttachment[]> {
  const out: StoredAttachment[] = [];
  for (const f of files) out.push({ ...f, owned: !(await isFileReferenced(f.fileUrl)) });
  return out;
}

// 예약이 취소되거나 채널이 사라져 소멸할 때, 미리 올려둔 첨부 파일을 지운다 (디렉터 지시 2026-09-16).
// 관문 둘: ①내가 데려온 파일만(owned) ②그 사이 누가 쓰기 시작했으면 두지 않는다.
export async function deleteWorkAttachmentFiles(attachments: unknown, scheduledId?: string) {
  for (const a of readAttachments(attachments)) {
    if (!a.owned) continue;
    // 확인에 실패하면 **지우지 않는다** — 파일은 나중에 지울 수 있지만 지워진 파일은 못 되돌린다
    let used = true;
    try { used = await isFileReferenced(a.fileUrl, scheduledId); }
    catch (e) { console.error("[첨부 삭제] 사용 여부 확인 실패 — 지우지 않는다:", e); continue; }
    if (used) continue;
    const name = path.basename(bareUrl(a.fileUrl));
    if (!name || name === "." || name === "..") continue;
    await fs.unlink(path.join(process.cwd(), "uploads", "work", name)).catch(() => {});
  }
}
