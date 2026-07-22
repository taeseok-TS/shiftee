import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { currentLeaveYear } from "@/lib/leave-calc";
import { logAudit } from "@/lib/audit";

type Row = { name?: string; email?: string; total?: unknown };

// 연차 일괄 업로드 (관리자) — 이메일 매칭으로 총 연차를 한 번에 변경.
// apply=false: 미리보기(매칭 결과만), apply=true: 실제 적용.
// 사용 일수는 보존하고 잔여 = 새 총 연차 - 사용으로 재계산 (개별 "조정"과 동일 규칙).
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { rows, apply } = (await request.json()) as { rows?: Row[]; apply?: boolean };
  if (!Array.isArray(rows) || rows.length === 0)
    return NextResponse.json({ error: "업로드할 데이터가 없습니다." }, { status: 400 });
  if (rows.length > 500)
    return NextResponse.json({ error: "한 번에 500행까지 가능합니다." }, { status: 400 });

  const year = currentLeaveYear();
  const emails = rows.map((r) => String(r.email || "").trim().toLowerCase()).filter(Boolean);
  const [users, balances] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, email: { in: emails } },
      select: { id: true, email: true, name: true },
    }),
    prisma.leaveBalance.findMany({ where: { year } }),
  ]);
  const userMap = new Map<string, (typeof users)[number]>(users.map((u) => [u.email.toLowerCase(), u]));
  const balanceMap = new Map<string, (typeof balances)[number]>(balances.map((b) => [b.userId, b]));

  const results = rows.map((r) => {
    const email = String(r.email || "").trim().toLowerCase();
    const name = String(r.name || "").trim();
    const total = Number(r.total);
    if (!email)
      return { name, email, total: null, status: "invalid" as const, message: "이메일 없음" };
    if (!Number.isFinite(total) || total < 0 || total > 365)
      return { name, email, total: null, status: "invalid" as const, message: "연차 수가 올바르지 않음" };
    const user = userMap.get(email);
    if (!user)
      return { name, email, total, status: "not_found" as const, message: "미등록/퇴사 이메일" };
    const bal = balanceMap.get(user.id);
    const used = bal?.used ?? 0;
    return {
      name,
      email,
      total,
      userId: user.id,
      systemName: user.name,
      prevTotal: bal?.total ?? null,
      used,
      newRemaining: total - used,
      status: name && name !== user.name ? ("name_mismatch" as const) : ("ok" as const),
      message: name && name !== user.name ? `등록된 이름은 "${user.name}"` : "",
    };
  });

  const applicable = results.filter((r) => r.status === "ok" || r.status === "name_mismatch");

  if (!apply) {
    return NextResponse.json({ preview: true, year, results, applicableCount: applicable.length });
  }

  // 같은 이메일 중복 행은 마지막 값이 남는다 (upsert 순차 적용)
  for (const r of applicable) {
    const used = r.used ?? 0;
    await prisma.leaveBalance.upsert({
      where: { userId_year: { userId: r.userId!, year } },
      create: { userId: r.userId!, year, total: r.total!, used, remaining: r.total! - used },
      update: { total: r.total!, remaining: r.total! - used },
    });
  }

  await logAudit({
    actorId: session.userId,
    actorName: session.name,
    action: "LEAVE_BALANCE_BULK",
    targetType: "USER",
    targetId: null,
    targetName: null,
    detail: `연차 일괄 업로드 (${year}년): ${applicable.length}명 적용, ${results.length - applicable.length}행 건너뜀`,
  });

  return NextResponse.json({ success: true, year, applied: applicable.length, skipped: results.length - applicable.length, results });
}
