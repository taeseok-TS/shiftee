import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isRealDate } from "@/lib/schedule-payload";
import { kstTodayDateUTC } from "@/lib/kst";
import { logAudit } from "@/lib/audit";
import { isResigned } from "@/lib/resign";

export const dynamic = "force-dynamic";

// 원장대행 지정 — 본부(관리자)만 보고 만든다(2026-10-07 본부 답변 #3).
// 기간 안에는 그 지점의 원장 결재(휴가·근무일정·휴가 취소)를 대신한다. 계약서 서명은 대행하지 않는다.

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const dateUtc = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  // 끝난 지 30일이 지난 것은 목록에서 뺀다(기록은 남는다)
  const since = new Date(kstTodayDateUTC().getTime() - 30 * 86400_000);
  const rows = await prisma.approvalDelegate.findMany({
    where: { OR: [{ endDate: { gte: since } }, { revokedAt: { gte: since } }] },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 200,
  });
  const ids = [...new Set(rows.flatMap((r) => [r.delegateId, r.createdBy, r.revokedBy].filter(Boolean) as string[]))];
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, branch: true, role: true } })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  const today = kstTodayDateUTC().getTime();
  return NextResponse.json({
    delegates: rows.map((r) => ({
      id: r.id,
      branch: r.branch,
      delegateId: r.delegateId,
      delegateName: byId.get(r.delegateId)?.name ?? "(삭제된 계정)",
      delegateBranch: byId.get(r.delegateId)?.branch ?? null,
      delegateRole: byId.get(r.delegateId)?.role ?? null,
      startDate: ymd(r.startDate),
      endDate: ymd(r.endDate),
      note: r.note,
      createdByName: r.createdBy ? byId.get(r.createdBy)?.name ?? null : null,
      revokedAt: r.revokedAt,
      revokedByName: r.revokedBy ? byId.get(r.revokedBy)?.name ?? null : null,
      state: r.revokedAt ? "REVOKED" : r.endDate.getTime() < today ? "ENDED" : r.startDate.getTime() > today ? "UPCOMING" : "ACTIVE",
    })),
  });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const branch = typeof body?.branch === "string" ? body.branch.trim() : "";
  const delegateId = typeof body?.delegateId === "string" ? body.delegateId : "";
  const start = typeof body?.startDate === "string" ? body.startDate : "";
  const end = typeof body?.endDate === "string" ? body.endDate : "";
  const note = typeof body?.note === "string" && body.note.trim() ? body.note.trim().slice(0, 200) : null;

  if (!branch || !delegateId) return NextResponse.json({ error: "지점과 대행자를 골라 주세요." }, { status: 400 });
  if (!isRealDate(start) || !isRealDate(end)) return NextResponse.json({ error: "기간을 YYYY-MM-DD 로 입력해 주세요." }, { status: 400 });
  if (end < start) return NextResponse.json({ error: "종료일이 시작일보다 빠릅니다." }, { status: 400 });
  if (dateUtc(end).getTime() < kstTodayDateUTC().getTime()) return NextResponse.json({ error: "이미 지난 기간입니다." }, { status: 400 });
  // 종료일 포함 366일까지(시작일~종료일 차이 365일)
  if (dateUtc(end).getTime() - dateUtc(start).getTime() > 365 * 86400_000)
    return NextResponse.json({ error: "대행 기간은 1년을 넘을 수 없습니다." }, { status: 400 });

  const br = await prisma.branch.findFirst({ where: { name: branch, isActive: true }, select: { id: true } });
  if (!br) return NextResponse.json({ error: "등록된 지점이 아닙니다." }, { status: 400 });
  const who = await prisma.user.findUnique({ where: { id: delegateId }, select: { id: true, name: true, role: true, isActive: true, deletedAt: true, resignDate: true } });
  if (!who || !who.isActive || who.deletedAt || isResigned(who.resignDate)) return NextResponse.json({ error: "대행자를 찾을 수 없습니다." }, { status: 400 });
  // 관리자는 이미 모든 결재를 할 수 있어 대행이 필요 없다
  if (who.role === "ADMIN") return NextResponse.json({ error: "관리자는 대행자로 지정할 필요가 없습니다." }, { status: 400 });

  // 같은 지점·같은 사람의 기간이 겹치면 받지 않는다 — 하나를 해제해도 다른 행으로 권한이 남는다
  const overlap = await prisma.approvalDelegate.findFirst({
    where: { branch, delegateId, revokedAt: null, startDate: { lte: dateUtc(end) }, endDate: { gte: dateUtc(start) } },
    select: { id: true },
  });
  if (overlap) return NextResponse.json({ error: "같은 지점·같은 대행자의 기간이 이미 겹쳐 있습니다. 기존 지정을 해제한 뒤 다시 지정해 주세요." }, { status: 409 });

  const row = await prisma.approvalDelegate.create({
    data: { branch, delegateId, startDate: dateUtc(start), endDate: dateUtc(end), note, createdBy: session.userId },
  });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "APPROVAL_DELEGATE_CREATE",
    targetType: "USER", targetId: delegateId, targetName: who.name,
    detail: `원장대행 지정: ${branch} · ${who.name} · ${start} ~ ${end}${note ? ` · ${note}` : ""}`,
  });
  // 대행자에게 알린다 — 결재함이 생긴 걸 모르면 대행이 안 된다
  const { botSendDM } = await import("@/lib/bot");
  botSendDM(delegateId, `🗂 원장대행으로 지정되었습니다.

지점: ${branch}
기간: ${start} ~ ${end}

기간 동안 이 지점의 휴가·근무일정 결재가 결재함에 들어옵니다. (계약서 서명은 대행하지 않습니다)`).catch(() => {});
  return NextResponse.json({ success: true, id: row.id });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "대상이 없습니다." }, { status: 400 });
  // 지우지 않고 해제 표시만 — 누가 언제 대행했는지 기록은 남긴다
  const claimed = await prisma.approvalDelegate.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date(), revokedBy: session.userId },
  });
  if (claimed.count === 0) return NextResponse.json({ error: "이미 해제됐거나 없는 지정입니다." }, { status: 409 });
  const row = await prisma.approvalDelegate.findUnique({ where: { id } });
  if (row) {
    const who = await prisma.user.findUnique({ where: { id: row.delegateId }, select: { name: true } });
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "APPROVAL_DELEGATE_REVOKE",
      targetType: "USER", targetId: row.delegateId, targetName: who?.name ?? null,
      detail: `원장대행 해제: ${row.branch} · ${who?.name ?? ""} · ${ymd(row.startDate)} ~ ${ymd(row.endDate)}`,
    });
    const { botSendDM } = await import("@/lib/bot");
    botSendDM(row.delegateId, `🗂 원장대행이 해제되었습니다.

지점: ${row.branch}
기간: ${ymd(row.startDate)} ~ ${ymd(row.endDate)}

이제 이 지점의 결재는 결재함에 들어오지 않습니다.`).catch(() => {});
  }
  return NextResponse.json({ success: true });
}
