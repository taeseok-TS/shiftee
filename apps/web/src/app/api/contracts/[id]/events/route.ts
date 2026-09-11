import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { recordContractEvent } from "@/lib/contract-events";

// 계약 이벤트(감사 기록, #205-4) — 관리자 화면에서 바로 본다(이예지대리 요청). 조회는 관리자만.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  const { id } = await params;
  const events = await prisma.contractEvent.findMany({
    where: { contractId: id },
    orderBy: { createdAt: "asc" },
    take: 500,
    select: { id: true, type: true, actorName: true, stepOrder: true, ip: true, userAgent: true, deviceId: true, meta: true, createdAt: true },
  });
  return NextResponse.json({ events });
}

// 열람 알림 — 화면이 문서를 열면 POST 로 알린다(GET 에 기록을 넣지 않는 규칙). 볼 권한이 있는 사람만, 10분 안 중복은 한 번.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { type?: string };
  if (body.type !== "VIEWED") return NextResponse.json({ error: "지원하지 않는 기록입니다." }, { status: 400 });
  const { canAccessContractFile } = await import("@/lib/contract-access");
  const acc = await canAccessContractFile({ contractId: id }, { userId: session.userId, role: session.role });
  if (!acc.allowed) return NextResponse.json({ error: acc.error }, { status: acc.status });
  const recent = await prisma.contractEvent.findFirst({
    where: { contractId: id, type: "VIEWED", actorId: session.userId, createdAt: { gt: new Date(Date.now() - 10 * 60 * 1000) } },
    select: { id: true },
  });
  if (!recent) await recordContractEvent({ contractId: id, type: "VIEWED", actorId: session.userId, actorName: session.name, request });
  return NextResponse.json({ ok: true });
}
