import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { decideChange } from "@/lib/portal-roster";

export const dynamic = "force-dynamic";

// 포털 인원명부 확인 대기 한 건 — { action: "apply" | "dismiss" } (본부 전용)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  if (body.action !== "apply" && body.action !== "dismiss") return NextResponse.json({ error: "동작이 올바르지 않습니다." }, { status: 400 });
  const r = await decideChange(id, body.action, { id: session.userId, name: session.name });
  if (r.ok === false) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true });
}
