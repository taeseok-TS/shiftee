import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveCaseViewer } from "@/lib/success-case-server";

export const dynamic = "force-dynamic";

// 축하 표시 켜기 · 끄기 (한 사람 한 번). 몸통 { on: boolean } — 없으면 뒤집는다.
// 숫자는 늘 실제 개수로 다시 센다(동시에 눌러도 어긋나지 않게).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await resolveCaseViewer(await getSession());
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { v } = r;
  const { id } = await params;
  const c = await prisma.successCase.findUnique({ where: { id }, select: { id: true, deletedAt: true } });
  if (!c || c.deletedAt) return NextResponse.json({ error: "사례를 찾을 수 없습니다." }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { on?: unknown };
  const key = { caseId_userId: { caseId: id, userId: v.userId } };
  const has = !!(await prisma.successCaseCheer.findUnique({ where: key, select: { userId: true } }));
  const on = typeof body.on === "boolean" ? body.on : !has;
  if (on && !has) await prisma.successCaseCheer.create({ data: { caseId: id, userId: v.userId } }).catch((e: unknown) => {
    if ((e as { code?: string })?.code !== "P2002") throw e; // 동시에 두 번 — 이미 있음만 넘긴다
  });
  if (!on && has) await prisma.successCaseCheer.deleteMany({ where: { caseId: id, userId: v.userId } });
  // 세기와 저장을 한 문장으로 — 동시에 눌러도 먼저 센 값이 나중에 덮지 않게(검증관 P5)
  const rows = await prisma.$queryRaw<{ n: number }[]>`UPDATE "SuccessCase" SET "cheerCount" = (SELECT count(*) FROM "SuccessCaseCheer" WHERE "caseId" = ${id})::int WHERE id = ${id} RETURNING "cheerCount" AS n`;
  const count = Number(rows[0]?.n ?? 0);
  return NextResponse.json({ on, cheerCount: count });
}
