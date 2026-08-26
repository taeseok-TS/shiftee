import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { firstFile, diskPath } from "@/lib/signed-doc";
import fs from "fs";

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

  const allowed = session.role === "ADMIN" || contract.userId === session.userId;
  if (!allowed)
    return NextResponse.json({ error: "관리자와 계약 당사자만 받을 수 있습니다." }, { status: 403 });

  const orig = firstFile(contract.fileUrl);
  if (!orig) return NextResponse.json({ error: "문서 파일이 없습니다." }, { status: 404 });
  const path = diskPath(orig);
  if (!fs.existsSync(path)) return NextResponse.json({ error: "문서 파일을 찾을 수 없습니다." }, { status: 404 });
  const buf = fs.readFileSync(path);

  const dispo = new URL(request.url).searchParams.get("inline") === "1" ? "inline" : "attachment";

  if (orig.toLowerCase().endsWith(".docx")) {
    try {
      const fd = new FormData();
      fd.append("files", new Blob([new Uint8Array(buf)]), "document.docx");
      const gres = await fetch(
        `${process.env.GOTENBERG_URL || "http://gotenberg:3000"}/forms/libreoffice/convert`,
        { method: "POST", body: fd }
      );
      if (gres.ok) {
        const pdf = Buffer.from(await gres.arrayBuffer());
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
