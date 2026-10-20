import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { SEND_LAYOUT_KEY, normalizeLayout, parseLayout } from "@/lib/contract-send-layout";

export const dynamic = "force-dynamic";

// 「계약서 보내기」 1단계 배치(즐겨찾기·묶음·카드 순서·용도 탭 순서) — 본부 전체 공유(2026-10-20 시안 v2 2·11번). 관리자만.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  const row = await prisma.appSetting.findUnique({ where: { key: SEND_LAYOUT_KEY } });
  return NextResponse.json({ layout: parseLayout(row?.value) });
}

// 배치 통째로 저장 — 화면이 바꾼 결과를 보낸다. 지워진(비활성) 양식은 정리하고, 묶음 이름이 바뀌거나 생기면 변경 로그에 남긴다
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body?.layout || typeof body.layout !== "object") return NextResponse.json({ error: "저장할 배치가 없습니다." }, { status: 400 });
  const next = normalizeLayout(body.layout);

  const result = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('contract-send-layout'))`;
    const prevRow = await tx.appSetting.findUnique({ where: { key: SEND_LAYOUT_KEY } });
    const prev = parseLayout(prevRow?.value);
    // 그 사이 다른 관리자가 저장했으면 거절 — 통째로 덮어 남의 묶음을 지우지 않게(검증 지적)
    if (next.rev !== prev.rev) return { conflict: prev };
    // 살아 있는 양식만 남긴다 — 묶음 안 양식이 2개 미만이 되면 그 묶음은 normalize 가 버리고, 즐겨찾기에서도 빠진다
    const ids = [...new Set([...next.tplOrder, ...next.bundles.flatMap((b) => b.templateIds), ...next.favorites.filter((f) => f.t === "tpl").map((f) => f.id)])];
    const alive = new Set((await tx.contractTemplate.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } })).map((t) => t.id));
    const cleaned = normalizeLayout({
      ...next,
      rev: prev.rev + 1,
      tplOrder: next.tplOrder.filter((id) => alive.has(id)),
      bundles: next.bundles.map((b) => ({ ...b, templateIds: b.templateIds.filter((id) => alive.has(id)) })),
      favorites: next.favorites.filter((f) => f.t !== "tpl" || alive.has(f.id)),
    });
    const value = JSON.stringify(cleaned);
    await tx.appSetting.upsert({ where: { key: SEND_LAYOUT_KEY }, create: { key: SEND_LAYOUT_KEY, value }, update: { value } });
    return { saved: cleaned, before: prev };
  });
  if ("conflict" in result) return NextResponse.json({ code: "CONFLICT", error: "다른 관리자가 방금 배치를 바꿨습니다. 새로 불러왔으니 다시 해 주세요.", layout: result.conflict }, { status: 409 });
  const { saved, before } = result;

  // 묶음이 생기거나 지워지거나 구성이 바뀐 것만 변경 로그에 — 순서·즐겨찾기 바꾸기는 남기지 않는다(자주 바뀐다)
  const sig = (b: { name: string; templateIds: string[] }) => `${b.name}:${b.templateIds.join(",")}`;
  const beforeMap = new Map(before.bundles.map((b) => [b.id, b]));
  const changes: string[] = [];
  for (const b of saved.bundles) {
    const p = beforeMap.get(b.id);
    if (!p) changes.push(`묶음 「${b.name}」 만듦(${b.templateIds.length}종)`);
    else if (sig(p) !== sig(b)) changes.push(`묶음 「${b.name}」 고침(${b.templateIds.length}종)`);
  }
  for (const p of before.bundles) if (!saved.bundles.some((b) => b.id === p.id)) changes.push(`묶음 「${p.name}」 지움`);
  if (changes.length) {
    await logAudit({ actorId: session.userId, actorName: session.name, action: "CONTRACT_SEND_LAYOUT", targetType: "AppSetting", targetId: SEND_LAYOUT_KEY, targetName: "계약서 보내기 묶음", detail: changes.join(" · ") });
  }
  return NextResponse.json({ layout: saved });
}
