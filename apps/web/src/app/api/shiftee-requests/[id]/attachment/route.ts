import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canSeeShifteeRequest } from "@/lib/shiftee-request-scope";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic" };
const DIR = path.join(process.cwd(), "uploads", "private", "shiftee-requests");

// 시프티 요청 첨부 사진(보관) — GET /api/shiftee-requests/[id]/attachment?name=<파일명>
// 권한은 목록과 같은 판정(lib/shiftee-request-scope): 본부 전부 · 원장은 담당 지점 직원 것 · 직원은 본인 것.
// 파일명은 그 요청의 attachments 배열에 든 이름만 연다(배열 밖 이름·경로 조작은 404) — 파일은 uploads/private 아래라 일반 업로드 경로로는 403.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const name = (request.nextUrl.searchParams.get("name") || "").trim();
  if (!name || name.includes("..") || name.includes("/") || name.includes("\\") || name !== path.basename(name))
    return NextResponse.json({ error: "파일 이름이 올바르지 않습니다." }, { status: 400 });

  const r = await prisma.shifteeRequest.findUnique({ where: { id }, select: { userId: true, branch: true, attachments: true } });
  if (!r) return NextResponse.json({ error: "기록이 없습니다." }, { status: 404 });
  if (!(await canSeeShifteeRequest(session, r))) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  if (!r.attachments.includes(name)) return NextResponse.json({ error: "이 기록에 그 첨부가 없습니다." }, { status: 404 });

  const ext = path.extname(name).toLowerCase();
  try {
    const buf = await fs.readFile(path.join(DIR, name));
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return NextResponse.json({ error: "첨부 파일을 찾을 수 없습니다." }, { status: 404 });
  }
}
