import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { portalFillableFields, portalHrContactConfigured } from "@/lib/portal-hr-contact";

export const dynamic = "force-dynamic";

// 계약 작성 화면용(#25) — 이 직원의 빈 프로필 칸 중 포털 인사카드가 채워 줄 수 있는 칸 **이름만** 돌려준다(값은 주지 않는다 — 본부 요청: 화면 노출 금지).
// 본부만. ?userId=
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부만 볼 수 있습니다." }, { status: 403 });
  const userId = new URL(request.url).searchParams.get("userId") || "";
  if (!userId) return NextResponse.json({ error: "userId 가 필요합니다." }, { status: 400 });
  if (!portalHrContactConfigured()) return NextResponse.json({ configured: false, fillable: [] });
  const u = await prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: { name: true, branch: true, address: true, birthDate: true, phone: true } });
  if (!u) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  const fillable = await portalFillableFields(u);
  return NextResponse.json({ configured: true, fillable });
}
