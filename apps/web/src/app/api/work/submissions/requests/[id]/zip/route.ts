import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveSubmissionViewer, submissionDiskPath } from "@/lib/submission-access";
import type { SubmissionFile } from "@/lib/submissions";
import PizZip from "pizzip";
import fs from "fs/promises";
import path from "path";

export const dynamic = "force-dynamic";

// ZIP 은 메모리에서 만든다(PizZip, 스트리밍 없음) — 합계가 이 상한을 넘으면 만들지 않고 안내한다.
// ⚠ 컨테이너 메모리 한도가 768m 이고 실측(재검증관) 입력 100MB 에 +450MB 라 상한은 80MB 로 둔다.
//   더 큰 묶음이 필요해지면 스트리밍 ZIP(archiver) 으로 바꾼다 — 의존성 추가라 1단계에서는 보류.
const MAX_ZIP_BYTES = 80 * 1024 * 1024;
// 한 번에 하나만 만든다 — 본부 둘이 동시에 누르면 2×(입력+생성) 으로 컨테이너 한도를 넘을 수 있다(3차 검증관 B)
let building = 0;

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
  // 먼저 크기 합계 — 상한을 넘으면 메모리에 올리기 전에 거절
  let total = 0;
  const entries: { s: (typeof subs)[number]; f: SubmissionFile; p: string }[] = [];
  for (const s of subs) {
    for (const f of (Array.isArray(s.files) ? s.files : []) as SubmissionFile[]) {
      const p = submissionDiskPath(f.url);
      if (!p) continue;
      const st = await fs.stat(p).catch(() => null);
      if (!st?.isFile()) continue;
      total += st.size;
      entries.push({ s, f, p });
    }
  }
  if (total > MAX_ZIP_BYTES)
    return NextResponse.json({ error: `파일 합계가 ${Math.round(total / 1048576)}MB 라 한 번에 묶을 수 없습니다(상한 80MB). 개별 파일로 내려받아주세요.` }, { status: 413 });

  if (building > 0) return NextResponse.json({ error: "다른 ZIP 을 만드는 중입니다. 잠시 뒤 다시 눌러주세요." }, { status: 503 });
  building++;
  try {
  const zip = new PizZip();
  const used = new Set<string>();
  let count = 0;
  for (const { s, f, p } of entries) {
    {
      let buf: Buffer;
      try { buf = await fs.readFile(p); } catch { continue; }
      const safe = (v: string) => path.basename(v).replace(/[\\/:*?"<>|]/g, "_").replace(/\.{2,}/g, ".");
      const folder = safe(s.userBranch || "지점없음");
      let name = `${folder}/${safe(s.userName)}_${safe(f.name)}`;
      if (used.has(name)) { const dot = name.lastIndexOf("."); name = dot > 0 ? `${name.slice(0, dot)}-${count}${name.slice(dot)}` : `${name}-${count}`; }
      used.add(name);
      zip.file(name, buf);
      count++;
    }
  }
  if (count === 0) return NextResponse.json({ error: "내려받을 파일이 없습니다." }, { status: 404 });
  // 입력이 대부분 이미 압축된 형식(docx·pptx·pdf·zip)이라 DEFLATE 이득이 없고 메모리만 먹는다 → STORE
  const out: Buffer = zip.generate({ type: "nodebuffer", compression: "STORE" });
  const zipName = `${r.title.replace(/[^a-zA-Z0-9가-힣._ -]/g, "_").trim() || "submissions"}.zip`;
  // Buffer 를 그대로 넘기면 fetch 규격대로 한 번 복사된다 — 스트림으로 감싸면 복사 없이 같은 메모리를 보낸다(3차 검증관 A 실측)
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(out.buffer, out.byteOffset, out.byteLength)); c.close(); } });
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Length": String(out.byteLength),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
    },
  });
  } finally { building--; }
}
