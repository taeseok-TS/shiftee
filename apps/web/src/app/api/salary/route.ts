import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { assertSalaryAccess, NO_STORE } from "@/lib/salary-access";
import { logAudit } from "@/lib/audit";
import { isResigned } from "@/lib/resign";

export const dynamic = "force-dynamic";

// 연봉 목록(2026-10-22 디렉터) — 사람마다 최신 계약·바로 앞 계약·이력. 인상 금액·인상률은 화면이 계산한다.
// 「연봉 보기」 권한 + 비밀번호 재확인(30분) 뒤에만(lib/salary-access).
export async function GET(request: NextRequest) {
  const session = await getSession();
  const gate = await assertSalaryAccess(request, session);
  if (!gate.ok) return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status, headers: NO_STORE });

  try {
  const recs = await prisma.salaryRecord.findMany({ orderBy: [{ empNo: "asc" }, { startDate: "asc" }] });
  const empNos = [...new Set(recs.map((r) => r.empNo))];
  const users = await prisma.user.findMany({
    where: { empNo: { in: empNos }, deletedAt: null },
    select: { empNo: true, name: true, branch: true, position: true, isActive: true, employmentStatus: true, resignDate: true },
  });
  const byEmp = new Map(users.map((u) => [u.empNo!, u]));
  const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
  const groups = new Map<number, typeof recs>();
  for (const r of recs) { const g = groups.get(r.empNo) ?? []; g.push(r); groups.set(r.empNo, g); }
  const people = [...groups.entries()].map(([empNo, rs]) => {
    const u = byEmp.get(empNo);
    const last = rs[rs.length - 1];
    const history = rs.map((r) => ({ id: r.id, startDate: ymd(r.startDate)!, endDate: ymd(r.endDate), amount: r.amount, jobTitle: r.jobTitle, renewed: r.renewed })).reverse();
    return {
      empNo, name: u?.name ?? last.name, sheetName: last.name, jobTitle: last.jobTitle,
      branch: u?.branch ?? null, matched: !!u,
      // 재직 = 큐브티에서 재직(퇴사일이 없거나 아직 오지 않음). 큐브티에 없거나 퇴사면 퇴사로 본다
      active: !!u && u.isActive && u.employmentStatus !== "RESIGNED" && !isResigned(u.resignDate),   // 퇴사일 당일은 재직(lib/resign)
      latest: history[0], prev: history[1] ?? null, history,
    };
  });
  const updatedAt = recs.reduce<Date | null>((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null);
  return NextResponse.json({ people, records: recs.length, updatedAt, expiresAt: gate.expiresAt ?? null }, { headers: NO_STORE });
  } catch {
    // 처리 안 된 오류는 시스템 로그(서브 관리자도 봄)에 남는다 — 연봉 자료가 섞이지 않게 여기서 끝낸다
    return NextResponse.json({ error: "불러오지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}

// 잘못 들어간 줄 하나 지우기(엑셀 오타로 생긴 줄 등) — 같은 권한·열쇠, 변경 로그에 남긴다(금액은 남기지 않는다)
export async function DELETE(request: NextRequest) {
  const session = await getSession();
  const gate = await assertSalaryAccess(request, session);
  if (!gate.ok) return NextResponse.json({ error: gate.error, code: gate.code }, { status: gate.status, headers: NO_STORE });
  const id = request.nextUrl.searchParams.get("id") || "";
  try {
    const r = await prisma.salaryRecord.findUnique({ where: { id }, select: { id: true, empNo: true, name: true, startDate: true } });
    if (!r) return NextResponse.json({ error: "없는 줄입니다." }, { status: 404, headers: NO_STORE });
    await prisma.salaryRecord.delete({ where: { id } });
    await logAudit({ actorId: session!.userId, actorName: session!.name, action: "SALARY_DELETE", targetType: "SALARY", targetId: id, targetName: r.name, detail: `연봉 이력 한 줄 지움(사번 ${r.empNo} · 시작 ${r.startDate.toISOString().slice(0, 10)})` });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "지우지 못했습니다." }, { status: 500, headers: NO_STORE });
  }
}
