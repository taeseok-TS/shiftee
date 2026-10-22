import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { assertSalaryAccess, NO_STORE } from "@/lib/salary-access";
import { parseSalaryFile, type SalaryParse } from "@/lib/salary-import";

export const dynamic = "force-dynamic";

// 연봉이력(RAW) 엑셀 올리기(2026-10-22 디렉터) — 미리보기(apply 없음) 또는 반영(apply=1).
// 같은 사번·같은 시작일이면 같은 계약으로 보고 값만 갱신한다(다시 올려도 겹치지 않는다). 파일에 없는 기존 줄은 지우지 않는다.
export async function POST(request: NextRequest) {
  const session = await getSession();
  const gate = await assertSalaryAccess(request, session);
  if (!gate.ok) return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status, headers: NO_STORE });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "엑셀 파일을 골라 주세요." }, { status: 400, headers: NO_STORE });
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: "파일이 너무 큽니다(10MB 이하)." }, { status: 400, headers: NO_STORE });
  let parsed: SalaryParse;
  try {
    parsed = parseSalaryFile(Buffer.from(await file.arrayBuffer()));
  } catch {
    return NextResponse.json({ error: "엑셀 파일을 읽지 못했습니다(xlsx·csv)." }, { status: 400, headers: NO_STORE });
  }
  const { rows, errors, sheet } = parsed;

  try {
  // 지금 값과 비교 — 새 줄 · 바뀐 줄 · 같은 줄
  const existing = await prisma.salaryRecord.findMany({ where: { empNo: { in: [...new Set(rows.map((r) => r.empNo))] } } });
  const key = (empNo: number, d: string) => `${empNo}|${d}`;
  const cur = new Map(existing.map((e) => [key(e.empNo, e.startDate.toISOString().slice(0, 10)), e]));
  let added = 0, changed = 0, same = 0;
  for (const r of rows) {
    const e = cur.get(key(r.empNo, r.startDate));
    if (!e) added++;
    else if (e.amount !== r.amount || (e.endDate?.toISOString().slice(0, 10) ?? null) !== r.endDate || e.renewed !== r.renewed || e.name !== r.name || (e.jobTitle ?? null) !== r.jobTitle) changed++;
    else same++;
  }
  const matched = await prisma.user.count({ where: { empNo: { in: [...new Set(rows.map((r) => r.empNo))] }, deletedAt: null } });
  const summary = { sheet, rows: rows.length, people: new Set(rows.map((r) => r.empNo)).size, matchedPeople: matched, added, changed, same, errors: errors.slice(0, 50), errorCount: errors.length };

  if (request.nextUrl.searchParams.get("apply") !== "1") return NextResponse.json({ preview: true, ...summary }, { headers: NO_STORE });
  if (!rows.length) return NextResponse.json({ error: "넣을 줄이 없습니다.", ...summary }, { status: 400, headers: NO_STORE });

  const batch = `sal_${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
  const day = (s: string) => new Date(`${s}T00:00:00Z`);
  await prisma.$transaction(rows.map((r) => prisma.salaryRecord.upsert({
    where: { empNo_startDate: { empNo: r.empNo, startDate: day(r.startDate) } },
    create: { empNo: r.empNo, name: r.name, jobTitle: r.jobTitle, startDate: day(r.startDate), endDate: r.endDate ? day(r.endDate) : null, amount: r.amount, renewed: r.renewed, importBatch: batch },
    update: { name: r.name, jobTitle: r.jobTitle, endDate: r.endDate ? day(r.endDate) : null, amount: r.amount, renewed: r.renewed, importBatch: batch },
  })));
  await logAudit({ actorId: session!.userId, actorName: session!.name, action: "SALARY_IMPORT", targetType: "SALARY", targetId: batch, targetName: "연봉이력", detail: `엑셀 반영 ${rows.length}줄(새 ${added} · 바뀜 ${changed} · 같음 ${same}) · ${summary.people}명` });
  return NextResponse.json({ applied: true, batch, ...summary }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "처리하지 못했습니다. 파일을 확인해 주세요." }, { status: 500, headers: NO_STORE });
  }
}
