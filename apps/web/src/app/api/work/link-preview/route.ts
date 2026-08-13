import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// URL 링크 미리보기 (OG 메타태그) — 온디맨드 조회 + 인메모리 캐시
// 스키마 변경 없음. 채널 메시지의 첫 URL을 클라이언트가 조회.

type Preview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
} | null; // null = 미리보기 없음(실패/비공개)

const CACHE_TTL = 1000 * 60 * 60 * 24; // 24시간
type CacheEntry = { at: number; data: Preview };
const g = globalThis as unknown as { __linkPreviewCache?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = g.__linkPreviewCache ?? (g.__linkPreviewCache = new Map());

// 사설/내부 대역 차단 (기본 SSRF 가드). 로그인 사용자 전용 + 호스트명 기준.
function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "0.0.0.0" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h === "::1" || h === "[::1]") return true;
  // IPv4 사설/루프백 대역
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [parseInt(m[1]), parseInt(m[2])];
    if (a === 127 || a === 10 || a === 0 || a === 169) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
  }
  return false;
}

function pickMeta(html: string, keys: string[]): string | null {
  for (const key of keys) {
    // property="og:title" content="..." (순서 무관)
    const re1 = new RegExp(
      `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`,
      "i"
    );
    const re2 = new RegExp(
      `<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`,
      "i"
    );
    const v = html.match(re1)?.[1] ?? html.match(re2)?.[1];
    if (v && v.trim()) return decodeEntities(v.trim());
  }
  return null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

async function fetchPreview(rawUrl: string): Promise<Preview> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (isBlockedHost(u.hostname)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(u.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; QubeteeBot/1.0; +link-preview)",
        Accept: "text/html,application/xhtml+xml",
      },
    });
    const ct = res.headers.get("content-type") || "";
    if (!res.ok || !ct.includes("text/html")) return null;
    // 최대 512KB만 읽기
    const buf = await res.arrayBuffer();
    const html = new TextDecoder("utf-8").decode(buf.slice(0, 512 * 1024));

    const title =
      pickMeta(html, ["og:title", "twitter:title"]) ??
      html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ??
      null;
    const description = pickMeta(html, ["og:description", "twitter:description", "description"]);
    let image = pickMeta(html, ["og:image", "twitter:image", "twitter:image:src"]);
    const siteName = pickMeta(html, ["og:site_name"]) ?? u.hostname.replace(/^www\./, "");

    // 상대경로 이미지 → 절대경로
    if (image && !/^https?:\/\//i.test(image)) {
      try {
        image = new URL(image, u.origin).toString();
      } catch {
        image = null;
      }
    }
    if (!title && !description && !image) return null;
    return { url: rawUrl, title: title ? decodeEntities(title) : null, description, image, siteName };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const url = request.nextUrl.searchParams.get("url");
  if (!url) return NextResponse.json({ error: "url이 필요합니다." }, { status: 400 });

  const now = Date.now();
  const hit = cache.get(url);
  if (hit && now - hit.at < CACHE_TTL) {
    return NextResponse.json({ preview: hit.data });
  }

  const data = await fetchPreview(url);
  cache.set(url, { at: now, data });
  return NextResponse.json({ preview: data });
}
