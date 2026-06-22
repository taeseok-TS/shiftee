import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import PizZip from "pizzip";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

function diskPath(fileUrl: string): string | null {
  if (!fileUrl.startsWith("/api/uploads/")) return null;
  const rel = fileUrl.replace(/^\/api\/uploads\//, "");
  return path.join(process.cwd(), "uploads", ...rel.split("/").map((s) => decodeURIComponent(s)));
}

// 채널 첨부파일 전체를 ZIP으로 묶어 다운로드 (참여자 누구나)
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;

  const channel = await prisma.workChannel.findUnique({ where: { id }, select: { name: true } });
  const msgs = await prisma.workMessage.findMany({
    where: { channelId: id, fileUrl: { not: null } },
    select: { fileUrl: true, fileName: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const zip = new PizZip();
  const used = new Set<string>();
  let count = 0;
  for (const m of msgs) {
    const p = m.fileUrl ? diskPath(m.fileUrl) : null;
    if (!p) continue;
    let buf: Buffer;
    try { buf = await fs.readFile(p); } catch { continue; }
    // 파일명 중복 방지
    let name = m.fileName || path.basename(p);
    if (used.has(name)) {
      const ext = path.extname(name); const base = name.slice(0, name.length - ext.length);
      name = `${base}-${count}${ext}`;
    }
    used.add(name);
    zip.file(name, buf);
    count++;
  }

  if (count === 0) return NextResponse.json({ error: "다운로드할 파일이 없습니다." }, { status: 404 });

  const out: Buffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = `${(channel?.name || "channel").replace(/[^a-zA-Z0-9가-힣._-]/g, "_")}-files.zip`;

  return new NextResponse(new Uint8Array(out), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
    },
  });
}
