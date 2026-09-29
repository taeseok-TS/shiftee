import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { EMOTICON_DIR, EMOTICON_MAX_BYTES, EMOTICON_URL_PREFIX } from "@/lib/emoticons";

const MAX_FILES = 30; // 30 × 3MB = 90MB — 프록시 본문 한도(110mb) 안(넘으면 본문이 잘려 원인과 다른 오류가 난다)

/**
 * 파일 앞부분(매직 바이트)으로 실제 형식을 본다 — 이름의 확장자는 믿지 않는다.
 * 움직이는지: GIF 는 그래픽 제어 블록이 2개 이상, WebP 는 ANIM 청크, PNG 는 acTL(APNG).
 */
function sniff(buf: Buffer): { ext: "png" | "gif" | "jpg" | "webp"; animated: boolean } | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf.toString("ascii", 1, 4) === "PNG") {
    return { ext: "png", animated: buf.includes(Buffer.from("acTL")) };
  }
  const head6 = buf.toString("ascii", 0, 6);
  if (head6 === "GIF87a" || head6 === "GIF89a") {
    let n = 0;
    const gce = Buffer.from([0x21, 0xf9, 0x04]);
    for (let i = buf.indexOf(gce); i !== -1 && n < 2; i = buf.indexOf(gce, i + 3)) n++;
    return { ext: "gif", animated: n >= 2 };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: "jpg", animated: false };
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", animated: buf.includes(Buffer.from("ANIM")) };
  }
  return null;
}

// 세트에 이모티콘 올리기(여러 장) — 이름은 파일 이름에서 확장자를 뺀 것
export async function POST(request: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });

  const { setId } = await params;
  const set = await prisma.emoticonSet.findUnique({ where: { id: setId }, select: { name: true } });
  if (!set) return NextResponse.json({ error: "세트를 찾을 수 없습니다." }, { status: 404 });

  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  const files = form.getAll("files").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
  if (!files.length) return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `한 번에 ${MAX_FILES}개까지 올릴 수 있습니다.` }, { status: 400 });

  // 모두 먼저 검사하고, 하나라도 틀리면 아무것도 저장하지 않는다(반쯤 올라간 세트가 남지 않게)
  const checked: { name: string; buf: Buffer; ext: string; animated: boolean }[] = [];
  for (const f of files) {
    if (f.size > EMOTICON_MAX_BYTES) {
      return NextResponse.json({ error: `「${f.name}」이(가) 너무 큽니다(3MB 이하).` }, { status: 400 });
    }
    const buf = Buffer.from(await f.arrayBuffer());
    const kind = sniff(buf);
    if (!kind) {
      return NextResponse.json({ error: `「${f.name}」은(는) PNG·GIF·JPG·WebP 그림이 아닙니다.` }, { status: 400 });
    }
    const name = (f.name || "이모티콘").replace(/\.[^.]+$/, "").trim().slice(0, 30) || "이모티콘";
    checked.push({ name, buf, ext: kind.ext, animated: kind.animated });
  }

  const dir = path.join(process.cwd(), "uploads", EMOTICON_DIR);
  await fs.mkdir(dir, { recursive: true });
  const last = await prisma.emoticon.findFirst({ where: { setId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  let order = last?.sortOrder ?? 0;

  const created: { id: string; name: string; url: string; animated: boolean }[] = [];
  const written: string[] = [];
  try {
    for (const c of checked) {
      const file = `${setId}_${Date.now()}_${randomBytes(6).toString("hex")}.${c.ext}`;
      await fs.writeFile(path.join(dir, file), c.buf);
      written.push(file);
      const e = await prisma.emoticon.create({
        data: { setId, name: c.name, url: `${EMOTICON_URL_PREFIX}${file}`, animated: c.animated, sortOrder: ++order },
        select: { id: true, name: true, url: true, animated: true },
      });
      created.push(e);
    }
  } catch (e) {
    // 도중 실패 — 이번에 쓴 파일·행을 되돌린다
    await prisma.emoticon.deleteMany({ where: { id: { in: created.map((c) => c.id) } } }).catch(() => {});
    for (const f of written) await fs.unlink(path.join(dir, f)).catch(() => {});
    console.error("[emoticon upload]", e);
    return NextResponse.json({ error: "저장 중 오류가 발생했습니다. 다시 시도해주세요." }, { status: 500 });
  }

  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMOTICON_UPLOAD",
    targetType: "EMOTICON_SET", targetId: setId, targetName: set.name,
    detail: `이모티콘 ${created.length}개 올림(움직임 ${created.filter((c) => c.animated).length})`,
  });
  return NextResponse.json({ items: created });
}

// 세트 안 이모티콘 순서 한 번에 — 원하는 순서대로 id 를 보내면 1,2,3… 으로 다시 매긴다(검증관 5)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });

  const { setId } = await params;
  const { itemIds } = (await request.json().catch(() => ({}))) as { itemIds?: unknown };
  if (!Array.isArray(itemIds) || !itemIds.every((x) => typeof x === "string")) {
    return NextResponse.json({ error: "순서가 올바르지 않습니다." }, { status: 400 });
  }
  const ids = itemIds as string[];
  const all = await prisma.emoticon.findMany({ where: { setId }, select: { id: true } });
  if (ids.length !== all.length || new Set(ids).size !== ids.length || !all.every((e) => ids.includes(e.id))) {
    return NextResponse.json({ error: "이모티콘 목록이 바뀌었습니다. 새로고침 후 다시 해주세요." }, { status: 409 });
  }
  try {
    await prisma.$transaction(ids.map((id, i) => prisma.emoticon.update({ where: { id }, data: { sortOrder: i + 1 } })));
  } catch {
    // 그사이 누가 지웠거나 다른 관리자와 동시에 바꿨다 — 데이터는 트랜잭션으로 그대로다
    return NextResponse.json({ error: "그사이 목록이 바뀌었습니다. 새로고침 후 다시 해주세요." }, { status: 409 });
  }
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMOTICON_REORDER",
    targetType: "EMOTICON_SET", targetId: setId, targetName: null, detail: `이모티콘 순서 ${ids.length}개 재정렬`,
  });
  return NextResponse.json({ success: true });
}
