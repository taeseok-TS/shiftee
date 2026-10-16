import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { PURPOSE_SETTING_KEY, normalizePurposes, parsePurposeMap, purposeLabel } from "@/lib/contract-purpose";

export const dynamic = "force-dynamic";

// 양식 용도(2026-10-17 「계약서 보내기」 화면, 본부 박정인 님 시안) — 본부가 고친 용도 맵 + 양식별 최근 사용일. 관리자만.
// 저장은 AppSetting 한 키(lib/contract-purpose PURPOSE_SETTING_KEY) — 스키마 변경 없음
async function readMap() {
  const row = await prisma.appSetting.findUnique({ where: { key: PURPOSE_SETTING_KEY } });
  return parsePurposeMap(row?.value ?? null);
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  const [purposes, used, sent] = await Promise.all([
    readMap(),
    // 최근 사용일 = 그 양식으로 마지막에 발송한 날(발송 기록 SENT·RESEND). 발송 기록이 없으면(기록 도입 전·초안만) 마지막 작성일.
    // 나에게 테스트 발송·모두싸인 이관본은 뺀다
    prisma.contract.groupBy({
      by: ["templateId"],
      where: { templateId: { not: null }, isTest: false, importBatch: null },
      _max: { createdAt: true },
    }).catch(() => [] as { templateId: string | null; _max: { createdAt: Date | null } }[]),   // 최근 사용일을 못 구해도 용도 맵은 내보낸다
    prisma.$queryRaw<{ templateId: string; at: Date }[]>`
      SELECT c."templateId" AS "templateId", MAX(e."createdAt") AS at
      FROM "ContractEvent" e JOIN "Contract" c ON c.id = e."contractId"
      WHERE e.type IN ('SENT', 'RESEND') AND c."templateId" IS NOT NULL AND c."isTest" = false AND c."importBatch" IS NULL
      GROUP BY c."templateId"`.catch(() => [] as { templateId: string; at: Date }[]),   // 발송 기록 표가 없는 인스턴스(고객사 설치 등)에서도 용도·작성일은 나오게
  ]);
  const lastUsed: Record<string, string> = {};
  for (const u of used) if (u.templateId && u._max.createdAt) lastUsed[u.templateId] = u._max.createdAt.toISOString();
  for (const s of sent) if (s.templateId && s.at) lastUsed[s.templateId] = new Date(s.at).toISOString();
  return NextResponse.json({ purposes, lastUsed });
}

// 한 양식의 용도 고치기 — body { templateId, purposes: 용도[] | null }. null 이면 기본값(이름 기준)으로 되돌린다
export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const templateId = typeof body?.templateId === "string" ? body.templateId : "";
  const next = normalizePurposes(body?.purposes);
  if (!templateId || next === undefined) return NextResponse.json({ error: "양식과 용도를 확인해 주세요." }, { status: 400 });
  const tpl = await prisma.contractTemplate.findUnique({ where: { id: templateId }, select: { id: true, name: true } });
  if (!tpl) return NextResponse.json({ error: "양식을 찾지 못했습니다." }, { status: 404 });

  // 읽고-고치고-쓰기를 한 줄로 세운다 — 두 관리자가 동시에 다른 양식을 고치면 나중 저장이 앞 저장을 지우던 경합(검증 5).
  // 트랜잭션 잠금(pg_advisory_xact_lock)은 트랜잭션이 끝나면 저절로 풀린다. 저장 때 지워진(비활성·없는) 양식 id 는 맵에서 정리한다
  const map = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('contract-purposes'))`;
    const row = await tx.appSetting.findUnique({ where: { key: PURPOSE_SETTING_KEY } });
    const m = parsePurposeMap(row?.value ?? null);
    if (next === null) delete m[templateId];
    else m[templateId] = next;
    const alive = new Set((await tx.contractTemplate.findMany({ where: { id: { in: Object.keys(m) }, isActive: true }, select: { id: true } })).map((t) => t.id));
    for (const id of Object.keys(m)) if (!alive.has(id) && id !== templateId) delete m[id];
    const value = JSON.stringify(m);
    await tx.appSetting.upsert({ where: { key: PURPOSE_SETTING_KEY }, create: { key: PURPOSE_SETTING_KEY, value }, update: { value } });
    return m;
  });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "CONTRACT_TEMPLATE_PURPOSE",
    targetType: "ContractTemplate", targetId: tpl.id, targetName: tpl.name,
    detail: next === null ? "기본값(이름 기준)으로" : next.length ? next.map(purposeLabel).join("·") : "기타(용도 없음)",
  });
  return NextResponse.json({ success: true, purposes: map });
}
