import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 시스템 에러 로그 조회 (관리자) — 최근 200건 + 24시간/7일 집계
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const now = Date.now();
  const [logs, count24h, count7d] = await Promise.all([
    prisma.systemErrorLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.systemErrorLog.count({ where: { createdAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } } }),
    prisma.systemErrorLog.count({ where: { createdAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) } } }),
  ]);
  return NextResponse.json({ logs, count24h, count7d });
}

// 처리 완료 표시/해제 (관리자)
export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const { id, resolved } = await request.json();
  if (typeof id !== "string" || typeof resolved !== "boolean")
    return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });

  const log = await prisma.systemErrorLog.update({
    where: { id },
    data: resolved
      ? { resolved: true, resolvedBy: session.name, resolvedAt: new Date() }
      : { resolved: false, resolvedBy: null, resolvedAt: null },
  });
  return NextResponse.json({ log });
}

// 로그 전체 비우기 (관리자)
export async function DELETE() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  await prisma.systemErrorLog.deleteMany({});
  return NextResponse.json({ success: true });
}
