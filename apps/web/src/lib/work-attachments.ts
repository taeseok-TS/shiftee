import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";

export type WorkAttachment = { fileUrl: string; fileName: string; fileType: string };

// 채팅 첨부 주소 검증 — 클라이언트가 주는 값이라 그대로 믿으면 안 된다.
// 계약서·서명·직인 경로를 넣어두고 첨부로 빼내는 우회가 있었다(2026-09-02). work 군만 허용한다.
export function okWorkAttachUrl(u: unknown): u is string {
  return (
    typeof u === "string" &&
    u.startsWith("/api/uploads/work/") &&
    !u.includes("..") &&
    !u.includes("\\") &&
    u.split("?")[0].split("/").length === 5
  );
}

// 예약 첨부 목록 정규화 (최대 10개). 형식이 어긋난 항목은 버린다.
export function parseAttachments(raw: unknown): WorkAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const { fileUrl, fileName, fileType } = a as Record<string, unknown>;
    if (!okWorkAttachUrl(fileUrl)) continue;
    out.push({
      fileUrl,
      fileName: typeof fileName === "string" && fileName.trim() ? fileName.slice(0, 255) : "file",
      fileType:
        fileType === "image" || fileType === "video" || fileType === "audio" ? fileType : "file",
    });
    if (out.length >= 10) break;
  }
  return out;
}

// 예약이 취소되거나 채널이 사라져 소멸할 때, 미리 올려둔 첨부 파일을 지운다 (디렉터 지시 2026-09-16).
// 이미 어떤 메시지가 그 파일을 쓰고 있으면(전달 등) 남의 메시지를 깨뜨리지 않게 건드리지 않는다.
export async function deleteWorkAttachmentFiles(attachments: unknown) {
  for (const a of parseAttachments(attachments)) {
    const used = await prisma.workMessage.findFirst({
      where: { fileUrl: a.fileUrl },
      select: { id: true },
    });
    if (used) continue;
    const name = path.basename(a.fileUrl.split("?")[0]);
    if (!name || name === "." || name === "..") continue;
    await fs.unlink(path.join(process.cwd(), "uploads", "work", name)).catch(() => {});
  }
}
