import { prisma } from "@/lib/db";

/**
 * 큐브티워크 이모티콘(스티커) — 2026-09-29 디렉터 지시.
 *
 * 스티커 메시지는 WorkMessage 에 fileType = "sticker", fileUrl = Emoticon.url 로 남는다.
 * 그림 파일은 uploads/emoticons/ 에 있고, 주소는 /api/uploads/emoticons/<파일> 이다.
 *
 * ⚠ 보내는 쪽 주소는 클라이언트가 주는 값이라 그대로 믿지 않는다 — **등록된 이모티콘 주소**
 *   (세트·항목 모두 켜져 있는 것)만 스티커로 받는다. 안 그러면 fileType 만 "sticker" 로 바꿔
 *   임의 경로(계약서·서명 등)를 큰 그림으로 띄울 수 있다(2026-09-02 첨부 경로 우회와 같은 부류).
 */
export const EMOTICON_DIR = "emoticons";
export const EMOTICON_URL_PREFIX = `/api/uploads/${EMOTICON_DIR}/`;
export const EMOTICON_EXT = new Set([".png", ".gif", ".webp", ".jpg", ".jpeg"]);
export const EMOTICON_MAX_BYTES = 3 * 1024 * 1024; // 움직이는 GIF 를 감안한 상한

export type EmoticonItem = { id: string; name: string; url: string; animated: boolean };
export type EmoticonSetView = { id: string; name: string; items: EmoticonItem[] };

/** 고르는 창에 보일 세트(켜진 세트의 켜진 항목, 순서대로). 비어 있는 세트는 뺀다. */
export async function listActiveEmoticonSets(): Promise<EmoticonSetView[]> {
  const sets = await prisma.emoticonSet.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      items: {
        where: { isActive: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, url: true, animated: true },
      },
    },
  });
  return sets.filter((s) => s.items.length > 0);
}

/** 스티커로 보낼 수 있는 주소인지 — 켜진 세트의 켜진 항목만. 찾으면 이름을 돌려준다(알림 문구용). */
export async function findSendableEmoticon(url: unknown): Promise<{ name: string } | null> {
  if (typeof url !== "string" || !url.startsWith(EMOTICON_URL_PREFIX)) return null;
  const e = await prisma.emoticon.findUnique({
    where: { url },
    select: { name: true, isActive: true, set: { select: { isActive: true } } },
  });
  if (!e || !e.isActive || !e.set.isActive) return null;
  return { name: e.name };
}
