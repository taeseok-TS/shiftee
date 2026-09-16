import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { firstFile, diskPath } from "@/lib/signed-doc";
import fs from "fs";
import { fileCacheKey, bufferCacheKey, readCachedPdf, writeCachedPdf } from "@/lib/pdf-cache";

// 서명 전 원본(작성본) 다운로드를 PDF로 — 워드 파일이 그대로 나가면 수정·유출 위험 (개선 제안 #67~#71).
// gotenberg가 죽어 있으면 워드로 폴백해 다운로드 자체는 항상 된다.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const contract = await prisma.contract.findUnique({
    where: { id },
    select: { id: true, userId: true, title: true, fileUrl: true },
  });
  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  // 권한은 lib/contract-access 한 곳에서 판정한다 — 종전에는 당사자면 무조건 통과라
  // 열람 금지(none) 문서도 이 경로로 첨부 다운로드가 됐다 (2026-09-02).
  const { canAccessContractFile } = await import("@/lib/contract-access");
  const acc = await canAccessContractFile({ contractId: id }, { userId: session.userId, role: session.role });
  if (!acc.allowed) return NextResponse.json({ error: acc.error }, { status: acc.status });

  const orig = firstFile(contract.fileUrl);
  if (!orig) return NextResponse.json({ error: "문서 파일이 없습니다." }, { status: 404 });
  const path = diskPath(orig);
  if (!fs.existsSync(path)) return NextResponse.json({ error: "문서 파일을 찾을 수 없습니다." }, { status: 404 });
  const buf = fs.readFileSync(path);

  // 열람만 허용된 문서는 첨부(다운로드)로 내려주지 않는다
  const dispo = acc.viewOnly || new URL(request.url).searchParams.get("inline") === "1" ? "inline" : "attachment";

  if (orig.toLowerCase().endsWith(".docx")) {
    // 변환 결과 디스크 캐시 (#179, 2026-09-16 디렉터 지시로 이 경로까지 넓혔다 — 측정 1.4초→0.5초).
    // 키는 문서 뷰어(/api/docs/pdf)와 같은 형식이라 같은 파일이면 **서로의 캐시를 그대로 쓴다.**
    // 파일이 재생성되면 이름 자체가 바뀌고, 교체돼도 mtime.크기가 달라져 새 키가 된다.
    const st = fs.statSync(path);
    const m = /\/api\/uploads\/([^/]+)\/([^/?#]+)$/.exec(orig);
    const cacheKey = m
      ? fileCacheKey(decodeURIComponent(m[1]), decodeURIComponent(m[2]), st.mtimeMs, st.size)
      : bufferCacheKey(buf);
    const hit = await readCachedPdf(cacheKey);
    if (hit) {
      return new NextResponse(new Uint8Array(hit), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${dispo}; filename*=UTF-8''${encodeURIComponent(contract.title + ".pdf")}`,
        },
      });
    }
    try {
      const fd = new FormData();
      fd.append("files", new Blob([new Uint8Array(buf)]), "document.docx");
      const gres = await fetch(
        `${process.env.GOTENBERG_URL || "http://gotenberg:3000"}/forms/libreoffice/convert`,
        { method: "POST", body: fd, signal: AbortSignal.timeout(60_000) } // 제한 시간 — 넘기면 catch 로(워드 또는 503)
      );
      if (gres.ok) {
        const pdf = Buffer.from(await gres.arrayBuffer());
        void writeCachedPdf(cacheKey, pdf); // 저장은 응답을 막지 않는다
        return new NextResponse(pdf, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `${dispo}; filename*=UTF-8''${encodeURIComponent(contract.title + ".pdf")}`,
          },
        });
      }
      console.error("원본 PDF 변환 실패(gotenberg):", gres.status);
    } catch (e) {
      console.error("원본 PDF 변환 오류(gotenberg):", e);
    }
    // 열람만 허용된 문서는 워드 원본으로 폴백하지 않는다 — 브라우저가 못 그려 결국 저장되므로
    // "열람만"이 무너진다. 변환이 안 되면 차라리 실패시킨다.
    if (acc.viewOnly)
      return NextResponse.json({ error: "지금은 문서를 열 수 없습니다. 잠시 후 다시 시도해주세요." }, { status: 503 });
    return new NextResponse(buf, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `${dispo}; filename*=UTF-8''${encodeURIComponent(contract.title + ".docx")}`,
      },
    });
  }
  // PDF 등 비워드 파일은 그대로
  const ext = orig.slice(orig.lastIndexOf(".")) || "";
  return new NextResponse(buf, {
    headers: {
      "Content-Type": ext === ".pdf" ? "application/pdf" : "application/octet-stream",
      "Content-Disposition": `${dispo}; filename*=UTF-8''${encodeURIComponent(contract.title + ext)}`,
    },
  });
}
