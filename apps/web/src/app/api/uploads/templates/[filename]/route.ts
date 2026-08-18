import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";

// 요청 시점에 디스크에서 읽으므로 정적 프리렌더 금지
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  try {
    // 계약 템플릿은 관리자 전용. 이 경로가 [...path] 보다 구체적이라 여기서 먼저 처리되므로
    // 여기를 빼먹으면 [...path] 쪽 게이트가 무력해진다.
    const session = await getSession();
    if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    if (session.role !== "ADMIN")
      return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

    const { filename } = await params;

    // 보안: 경로 조회 방지
    if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
      return NextResponse.json({ error: "잘못된 파일명입니다." }, { status: 400 });
    }

    const filePath = path.join(process.cwd(), "uploads", "templates", filename);
    const file = await fs.readFile(filePath);

    const ext = path.extname(filename).toLowerCase();
    const contentType =
      ext === ".pdf"
        ? "application/pdf"
        : ext === ".docx"
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/octet-stream";

    const response = new NextResponse(file);
    response.headers.set("Content-Type", contentType);
    response.headers.set("Content-Disposition", `${ext === ".pdf" ? "inline" : "attachment"}; filename="${filename}"`);

    return response;
  } catch (error) {
    console.error("파일 다운로드 에러:", error);
    return NextResponse.json({ error: "파일을 찾을 수 없습니다." }, { status: 404 });
  }
}
