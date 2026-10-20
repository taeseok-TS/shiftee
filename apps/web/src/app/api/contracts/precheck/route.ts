import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requiredHqMissing } from "@/lib/contract-field-settings";
import { buildContractMergeData, isPdfTemplate, loadFieldSettings } from "@/lib/contract-fields";
import { findDuplicateSends } from "@/lib/contract-send-meta";

export const dynamic = "force-dynamic";

// 계약서 보내기 2단계 「보내기 전 확인」(2026-10-20 본부 박정인 시안 v2 3번 — 빨간 줄만 고치기 · n/n명 준비됨).
// 만들기(POST /api/contracts·/bundle)와 **같은 값 만들기·같은 검사**를 만들지 않고 미리 돌려 본다:
//  · 값 검증(최저임금·소정근로시간·기간·평가 기간 — lib/contract-validate)
//  · PDF 배치 양식의 본부 필수 칸
//  · 같은 직원에게 같은 양식을 진행 중이거나 30일 안에 보낸 것(발송 때 묻는 중복 경고와 같은 기준 — 여기서는 미리 보여 주기만)
// 관리자만(계약서 보내기 화면은 /admin). 사람 200명·한 사람 서류 8종까지.
type Row = { userId?: unknown; items?: unknown };
type Item = { templateId?: unknown; title?: unknown; startDate?: unknown; endDate?: unknown; salary?: unknown; extraFields?: unknown };

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 쓸 수 있습니다." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null;
  const rows = Array.isArray(body?.rows) ? (body!.rows as Row[]).slice(0, 200) : null;
  if (!rows) return NextResponse.json({ error: "rows 가 필요합니다." }, { status: 400 });

  const templateCache = new Map<string, { id: string; fileUrl: string; type: string; name: string } | null>();
  const tpl = async (id: string) => {
    if (!templateCache.has(id)) templateCache.set(id, await prisma.contractTemplate.findUnique({ where: { id }, select: { id: true, fileUrl: true, type: true, name: true } }));
    return templateCache.get(id) ?? null;
  };
  const { validateContractMerge } = await import("@/lib/contract-validate");
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  const results: { userId: string; errors: string[]; duplicates: { title: string; status: string; lastSentAt: string | null }[] }[] = [];
  for (const r of rows) {
    const userId = str(r.userId);
    if (!userId) continue;
    const errors: string[] = [];
    const duplicates: { title: string; status: string; lastSentAt: string | null }[] = [];
    const items = Array.isArray(r.items) ? (r.items as Item[]).slice(0, 8) : [];
    for (const it of items) {
      const t = await tpl(str(it.templateId));
      if (!t) { errors.push("양식을 찾지 못했습니다."); continue; }
      const extra = it.extraFields && typeof it.extraFields === "object" ? (it.extraFields as Record<string, string>) : null;
      const startDate = str(it.startDate), endDate = str(it.endDate);
      try {
        const merge = await buildContractMergeData(userId, { templateId: t.id, title: str(it.title) || t.name, startDate, endDate, salary: str(it.salary), extraFields: extra, external: null });
        const verrs = await validateContractMerge(merge, { templateFileUrl: t.fileUrl, startDate: startDate || null, endDate: endDate || null });
        for (const e of verrs) errors.push(items.length > 1 ? `[${t.name}] ${e}` : e);
        if (isPdfTemplate(t.fileUrl)) {
          const miss = requiredHqMissing(merge, await loadFieldSettings(t.id));
          if (miss.length) errors.push(`${items.length > 1 ? `[${t.name}] ` : ""}필수 칸을 채워 주세요: ${miss.join(", ")}`);
        }
      } catch (e) {
        console.error("[precheck] 값 확인 오류:", e);
        errors.push(`${items.length > 1 ? `[${t.name}] ` : ""}값을 확인하지 못했습니다.`);
      }
      for (const d of await findDuplicateSends({ id: "", userId, templateId: t.id, type: t.type, title: str(it.title), externalName: null }).catch(() => [])) {
        duplicates.push({ title: d.title, status: d.status, lastSentAt: d.lastSentAt ? new Date(d.lastSentAt).toISOString() : null });
      }
    }
    results.push({ userId, errors: [...new Set(errors)], duplicates });
  }
  return NextResponse.json({ results });
}
