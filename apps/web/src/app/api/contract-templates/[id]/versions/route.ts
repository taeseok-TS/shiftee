import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// 템플릿 파일 이력(#78) — 지금 파일 + 바뀌기 전 파일들(최신순). 관리자만
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  const { id } = await params;
  const t = await prisma.contractTemplate.findUnique({ where: { id }, select: { id: true, name: true, version: true, fileUrl: true, updatedAt: true } });
  if (!t) return NextResponse.json({ error: "템플릿을 찾을 수 없습니다." }, { status: 404 });
  const past = await prisma.contractTemplateVersion.findMany({ where: { templateId: id }, orderBy: [{ version: "desc" }, { createdAt: "desc" }] });
  const names = new Map(
    (await prisma.user.findMany({ where: { id: { in: past.map((p) => p.replacedBy).filter((x): x is string => !!x) } }, select: { id: true, name: true } }))
      .map((u) => [u.id, u.name] as [string, string]),
  );
  // 계약에 남은 발송 당시 버전(#48)별 건수 — 어느 버전으로 몇 건 나갔는지
  const used = await prisma.contract.groupBy({ by: ["templateVersion"], where: { templateId: id, templateVersion: { not: null } }, _count: { _all: true } });
  const usedBy = new Map(used.map((u) => [u.templateVersion as number, u._count._all]));
  // 이 기능 전에 바뀐 버전은 파일 기록이 없다 — 발송 건수만이라도 보여 준다(#78 검증 F4)
  const known = new Set([t.version, ...past.map((p) => p.version)]);
  const unrecorded = [...usedBy.entries()].filter(([v]) => !known.has(v)).sort((a, b) => b[0] - a[0]).map(([version, sent]) => ({ version, sent }));
  return NextResponse.json({
    name: t.name,
    unrecorded,
    current: { version: t.version, fileUrl: t.fileUrl, sent: usedBy.get(t.version) ?? 0 },
    past: past.map((p) => ({ id: p.id, version: p.version, fileUrl: p.fileUrl, replacedAt: p.createdAt, replacedBy: p.replacedBy ? names.get(p.replacedBy) ?? null : null, sent: usedBy.get(p.version) ?? 0 })),
  });
}
