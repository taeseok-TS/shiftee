import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { approverScopeFor, isMyStep } from "@/lib/approval-delegate";
import { getManagerBranches } from "@/lib/manager-branches";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic" };

// 사진 출퇴근 요청의 지점 사진 — 신청자, 본부, 그 지점 원장(처리 뒤 기록 확인용), 결재 차례인 원장대행만 연다.
// 파일은 uploads/private 아래라 일반 업로드 경로로는 열리지 않는다.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const r = await prisma.attendanceRequest.findUnique({
    where: { id },
    select: { userId: true, photoPath: true, status: true, approverRole: true, branch: true, user: { select: { role: true, branch: true } } },
  });
  if (!r?.photoPath) return NextResponse.json({ error: "사진이 없습니다." }, { status: 404 });

  let allowed = session.role === "ADMIN" || r.userId === session.userId;
  if (!allowed && session.role === "MANAGER" && r.user.branch) {
    allowed = (await getManagerBranches(session.userId)).includes(r.user.branch);
  }
  if (!allowed && session.role !== "ADMIN") {
    const scope = await approverScopeFor(session);
    allowed = isMyStep({ status: r.status, approverRole: r.approverRole, branch: r.branch, approverId: null }, session, scope, r.user.role);
  }
  if (!allowed) return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const name = path.basename(r.photoPath);   // 저장값은 파일 이름뿐 — 경로 조작을 한 번 더 막는다
  const ext = path.extname(name).toLowerCase();
  try {
    const buf = await fs.readFile(path.join(process.cwd(), "uploads", "private", "attendance-photos", name));
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": TYPES[ext] ?? "application/octet-stream", "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json({ error: "사진 파일을 찾을 수 없습니다." }, { status: 404 });
  }
}
