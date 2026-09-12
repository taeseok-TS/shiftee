import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveSubmissionViewer, submissionDiskPath } from "@/lib/submission-access";
import type { SubmissionFile } from "@/lib/submissions";
import PizZip from "pizzip";
import fs from "fs/promises";

export const dynamic = "force-dynamic";

// 요청의 제출 파일을 ZIP 한 번에 — 본부는 전부, 원장은 담당 지점만. 폴더는 지점/이름_파일명.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const v = await resolveSubmissionViewer(session, null);
  if (!v || v.role === "EMPLOYEE") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const { id } = await params;
  const r = await prisma.submissionRequest.findUnique({ where: { id }, select: { title: true } });
  if (!r) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
  const subs = await prisma.submission.findMany({
    where: { requestId: id, deletedAt: null, ...(v.role === "MANAGER" ? { userBranch: { in: v.branches } } : {}) },
    select: { userName: true, userBranch: true, files: true },
    orderBy: [{ userBranch: "asc" }, { userName: "asc" }],
  });
  const zip = new PizZip();
  const used = new Set<string>();
  let count = 0;
  for (const s of subs) {
    const files = (Array.isArray(s.files) ? s.files : []) as SubmissionFile[];
    for (const f of files) {
      const p = submissionDiskPath(f.url);
      if (!p) continue;
      let buf: Buffer;
      try { buf = await fs.readFile(p); } catch { continue; }
      const folder = (s.userBranch || "지점없음").replace(/[\\/:*?"<>|]/g, "_");
      let name = `${folder}/${s.userName}_${f.name}`.replace(/[:*?"<>|]/g, "_");
      if (used.has(name)) { const dot = name.lastIndexOf("."); name = dot > 0 ? `${name.slice(0, dot)}-${count}${name.slice(dot)}` : `${name}-${count}`; }
      used.add(name);
      zip.file(name, buf);
      count++;
    }
  }
  if (count === 0) return NextResponse.json({ error: "내려받을 파일이 없습니다." }, { status: 404 });
  const out: Buffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = `${r.title.replace(/[^a-zA-Z0-9가-힣._ -]/g, "_").trim() || "submissions"}.zip`;
  return new NextResponse(new Uint8Array(out), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
    },
  });
}
