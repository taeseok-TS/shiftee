import { NextRequest, NextResponse } from "next/server";
import { getSession, isSuperAdmin, clearSessionCache } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { syncMainManagerFor } from "@/lib/manager-branches";
import { kstTodayMidnight } from "@/lib/resign";

export const dynamic = "force-dynamic";

// 잘못 넣은 퇴사를 되돌린다 — 퇴직자 현황 「재직으로 되돌리기」(2026-11-09 박정인 요청 · 디렉터 지시).
// 지난 퇴사일이 들어가면 그 직원은 직원 관리 목록에서 빠지고 계정이 꺼져, 화면으로는 찾아서 되돌릴 길이 없었다.
//   - 퇴사일 · 사유를 지우고 재직(ACTIVE) · 계정 켬
//   - 퇴사 때 큐브티워크에서 빠진 채팅방에 다시 넣고(방이 아직 있을 때만), 상대 목록에서 숨긴 DM 을 다시 보이게 한다
//     (퇴사자 채팅 정리 기록 RESIGN_CHAT_CLEANUP 의 원본 값으로). 방장을 넘긴 방은 방장으로 되돌리지 않는다
//   - 지점 원장에게 「퇴사 해제」 알림(원장 환경설정 「지점 직원 변동 알림」)
// 휴지통(삭제)에 들어간 직원은 여기서 다루지 않는다 — 휴지통 「복구」를 쓴다.
type RemovedRow = { c: string; m?: 1; n?: string; p?: 1; r?: string; h?: string; j?: string };
type CleanupSnap = { removed?: RemovedRow[]; dmHidden?: string[]; handovers?: { channelId: string }[] };

function parseSnap(detail: string | null): CleanupSnap | null {
  if (!detail) return null;
  const i = detail.indexOf("{");
  if (i < 0) return null;
  try { return JSON.parse(detail.slice(i)) as CleanupSnap; } catch { return null; }
}
const toDate = (v?: string) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : null);

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 할 수 있습니다." }, { status: 403 });
  const { id } = await params;

  const u = await prisma.user.findUnique({
    where: { id },
    select: { id: true, name: true, role: true, branch: true, resignDate: true, resignReason: true, employmentStatus: true, deletedAt: true },
  });
  if (!u) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  if (u.deletedAt) return NextResponse.json({ error: "삭제된 직원입니다. 휴지통에서 복구해 주세요." }, { status: 409 });
  if (u.role === "ADMIN" && !(await isSuperAdmin(session.userId)))
    return NextResponse.json({ error: "관리자 계정 관리는 메인 관리자만 가능합니다." }, { status: 403 });

  const today = kstTodayMidnight();
  const resignedWhere = { OR: [{ employmentStatus: "RESIGNED" as const }, { resignDate: { lt: today } }] };
  // 두 사람이 동시에 눌러도 한 번만 — 조건부로 바꾸고 바뀐 줄이 없으면 이미 처리된 것
  const r = await prisma.user.updateMany({
    where: { id, deletedAt: null, ...resignedWhere },
    data: { resignDate: null, resignReason: null, employmentStatus: "ACTIVE", isActive: true },
  });
  if (!r.count) return NextResponse.json({ error: "퇴사 상태인 직원이 아닙니다(이미 되돌렸을 수 있습니다)." }, { status: 409 });
  clearSessionCache(id);   // 「비활성」 캐시가 남아 있으면 30초 동안 로그인이 안 된다
  await syncMainManagerFor(id).catch(() => {});

  // 채팅 되돌리기 — 직전 되돌리기(또는 휴지통 복구 · 재입사) 이후의 퇴사 정리 기록만 쓴다(예전 근무 때 방까지 되살리지 않게)
  let rejoined = 0, notFound = 0, dmShown = 0;
  try {
    const lastBack = await prisma.auditLog.findFirst({
      where: { targetId: id, action: { in: ["EMPLOYEE_UNRESIGN", "EMPLOYEE_RESTORE"] } },
      orderBy: { createdAt: "desc" }, select: { createdAt: true },
    });
    const logs = await prisma.auditLog.findMany({
      where: { targetId: id, action: "RESIGN_CHAT_CLEANUP", ...(lastBack ? { createdAt: { gt: lastBack.createdAt } } : {}) },
      orderBy: { createdAt: "asc" }, select: { detail: true },
    });
    const rows = new Map<string, RemovedRow & { handed: boolean }>();
    const dmIds = new Set<string>();
    for (const l of logs) {
      const s = parseSnap(l.detail);
      if (!s) continue;
      const handed = new Set((s.handovers ?? []).map((h) => h.channelId));
      for (const row of s.removed ?? []) if (row?.c) rows.set(row.c, { ...row, handed: handed.has(row.c) });
      for (const c of s.dmHidden ?? []) if (typeof c === "string") dmIds.add(c);
    }
    if (rows.size) {
      const alive = new Set((await prisma.workChannel.findMany({
        where: { id: { in: [...rows.keys()] }, type: "CHANNEL", deletedAt: null }, select: { id: true },
      })).map((c) => c.id));
      for (const row of rows.values()) {
        if (!alive.has(row.c)) { notFound++; continue; }
        const notify = row.n === "MENTION" || row.n === "MUTE" ? row.n : "ALL";
        const res = await prisma.workChannelMember.createMany({
          data: [{
            channelId: row.c, userId: id, notify, pinned: !!row.p,
            isManager: !!row.m && !row.handed,   // 방장을 넘긴 방은 새 방장을 그대로 둔다
            lastReadAt: toDate(row.r), historyFrom: toDate(row.h), joinedAt: toDate(row.j) ?? new Date(),
          }],
          skipDuplicates: true,
        });
        rejoined += res.count;
      }
    }
    if (dmIds.size) {
      const res = await prisma.workChannelMember.updateMany({
        where: { channelId: { in: [...dmIds] }, userId: { not: id }, hiddenAt: { not: null } },
        data: { hiddenAt: null },
      });
      dmShown = res.count;
    }
  } catch (e) {
    console.error("[퇴사 되돌리기] 채팅 되돌리기 실패:", id, e);
  }

  const rd = u.resignDate ? u.resignDate.toISOString().slice(0, 10) : "-";
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMPLOYEE_UNRESIGN",
    targetType: "USER", targetId: id, targetName: u.name,
    detail: `퇴사 되돌림 — 퇴사일 ${rd}${u.resignReason ? `(${u.resignReason})` : ""} 해제, 재직 · 계정 켬` +
      (rejoined ? `, 채팅방 ${rejoined}곳 다시 넣음` : "") + (notFound ? `, 없어진 방 ${notFound}곳 건너뜀` : "") +
      (dmShown ? `, DM ${dmShown}건 다시 보이게` : ""),
  });

  const { notifyStaffChanges } = await import("@/lib/staff-change-notify");
  void notifyStaffChanges([{ kind: "rehire", userId: id, name: u.name, branch: u.branch }], { actorId: session.userId });

  return NextResponse.json({ ok: true, name: u.name, rejoined, notFound, dmShown });
}
