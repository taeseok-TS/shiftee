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
//   - 되돌리지 못한 것(휴지통으로 간 방 · 기록이 길어 빠진 방 · 비어 있는 메인 원장 지정)은 응답으로 알려 화면에 띄운다
//   - 지점 원장에게 「퇴사 처리 취소」 알림(원장 환경설정 「지점 직원 변동 알림」)
// 휴지통(삭제)에 들어간 직원은 여기서 다루지 않는다 — 휴지통 「복구」를 먼저 쓴다(복구해도 퇴사 상태는 남아 여기서 이어서 되돌린다).
type RemovedRow = { c: string; m?: 1; n?: string; p?: 1; r?: string; h?: string; j?: string };
type CleanupSnap = { removed?: RemovedRow[]; dmHidden?: string[]; handovers?: { channelId: string }[]; omitted?: number };

function parseSnap(detail: string | null): CleanupSnap | null {
  if (!detail) return null;
  const i = detail.indexOf("{");   // 앞 설명 글에는 '{' 가 없다
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
    select: {
      id: true, name: true, role: true, branch: true, resignDate: true, resignReason: true, employmentStatus: true, deletedAt: true,
      managerBranches: { select: { branchName: true } },
    },
  });
  if (!u) return NextResponse.json({ error: "직원을 찾을 수 없습니다." }, { status: 404 });
  if (u.deletedAt) return NextResponse.json({ error: "삭제된 직원입니다. 휴지통에서 먼저 복구한 뒤 다시 눌러 주세요." }, { status: 409 });
  if (u.role === "ADMIN" && !(await isSuperAdmin(session.userId)))
    return NextResponse.json({ error: "관리자 계정 관리는 메인 관리자만 가능합니다." }, { status: 403 });

  const today = kstTodayMidnight();
  // 두 사람이 동시에 눌러도 한 번만 — 조건부로 바꾸고 바뀐 줄이 없으면 이미 처리된 것
  const r = await prisma.user.updateMany({
    where: { id, deletedAt: null, OR: [{ employmentStatus: "RESIGNED" }, { resignDate: { lt: today } }] },
    data: { resignDate: null, resignReason: null, employmentStatus: "ACTIVE", isActive: true },
  });
  if (!r.count) return NextResponse.json({ error: "퇴사 상태인 직원이 아닙니다(이미 되돌렸을 수 있습니다)." }, { status: 409 });
  clearSessionCache(id);   // 「비활성」 캐시가 남아 있으면 30초 동안 로그인이 안 된다
  await syncMainManagerFor(id).catch(() => {});

  // 채팅 되돌리기 — **이번 퇴사** 때 생긴 정리 기록만 쓴다. 예전 근무 때 기록까지 쓰면 지난번에 나간 방에 옛 값으로 다시 들어간다(검증 2).
  //   ① 마지막 「퇴사 해제」(이 되돌리기 · 직원 수정으로 지난 퇴사일 지움 · 인사명부 재입사 반영) 뒤의 기록만
  //   ② 그리고 이번 퇴사일 이후의 기록만(정리는 퇴사일이 지나야 돈다) — 「퇴사 해제」 표시가 없던 11/9 이전 재입사도 걸러진다
  //   휴지통 「복구」(EMPLOYEE_RESTORE · 직원 복구)는 퇴사 상태를 그대로 두므로 기준점이 아니다(검증 1)
  let rejoined = 0, trashedRooms = 0, goneRooms = 0, omitted = 0, dmShown = 0, chatError = false;
  try {
    const lastBack = await prisma.auditLog.findFirst({
      where: {
        targetId: id,
        OR: [
          { action: "EMPLOYEE_UNRESIGN" },
          { action: "EMPLOYEE_UPDATE", detail: { contains: "퇴사 해제" } },
          { action: "EMPLOYEE_RESTORE", detail: { contains: "재입사 반영" } },
        ],
      },
      orderBy: { createdAt: "desc" }, select: { createdAt: true },
    });
    const from = [lastBack?.createdAt, u.resignDate].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
    const logs = await prisma.auditLog.findMany({
      where: { targetId: id, action: "RESIGN_CHAT_CLEANUP", ...(from ? { createdAt: { gt: from } } : {}) },
      orderBy: { createdAt: "asc" }, select: { detail: true },
    });
    const rows = new Map<string, RemovedRow & { handed: boolean }>();
    const dmIds = new Set<string>();
    for (const l of logs) {
      const s = parseSnap(l.detail);
      if (!s) continue;
      omitted += Math.max(0, Number(s.omitted) || 0);   // 기록이 길어 덜어낸 방 — 어느 방인지 몰라 되돌릴 수 없다(검증 3)
      const handed = new Set((s.handovers ?? []).map((h) => h.channelId));
      for (const row of s.removed ?? []) if (row?.c) rows.set(row.c, { ...row, handed: handed.has(row.c) });
      for (const c of s.dmHidden ?? []) if (typeof c === "string") dmIds.add(c);
    }
    if (rows.size) {
      const chans = await prisma.workChannel.findMany({
        where: { id: { in: [...rows.keys()] }, type: "CHANNEL" }, select: { id: true, deletedAt: true },
      });
      const state = new Map(chans.map((c) => [c.id, c.deletedAt ? "trash" : "alive"]));
      for (const row of rows.values()) {
        const st = state.get(row.c);
        if (st !== "alive") { if (st === "trash") trashedRooms++; else goneRooms++; continue; }
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
    chatError = true;
    console.error("[퇴사 되돌리기] 채팅 되돌리기 실패:", id, e);
  }

  // 메인 원장 지정은 퇴사 때 풀리고 되살리지 않는다 — 원장이면 담당 지점 중 비어 있는 곳을 알려 지점 관리에서 다시 고르게 한다(검증 5)
  let mainManagerEmpty: string[] = [];
  if (u.role === "MANAGER") {
    const names = [...new Set([u.branch, ...u.managerBranches.map((b) => b.branchName)].filter(Boolean) as string[])];
    if (names.length)
      mainManagerEmpty = (await prisma.branch.findMany({ where: { name: { in: names }, mainManagerId: null }, select: { name: true } })).map((b) => b.name);
  }

  const rd = u.resignDate ? u.resignDate.toISOString().slice(0, 10) : "-";
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "EMPLOYEE_UNRESIGN",
    targetType: "USER", targetId: id, targetName: u.name,
    detail: `퇴사 되돌림 — 퇴사일 ${rd}${u.resignReason ? `(${u.resignReason})` : ""} 해제, 재직 · 계정 켬` +
      (rejoined ? `, 채팅방 ${rejoined}곳 다시 넣음` : "") +
      (trashedRooms ? `, 휴지통으로 간 방 ${trashedRooms}곳 못 넣음` : "") +
      (goneRooms ? `, 없어진 방 ${goneRooms}곳` : "") +
      (omitted ? `, 기록에서 빠진 방 ${omitted}곳 못 넣음` : "") +
      (dmShown ? `, DM ${dmShown}건 다시 보이게` : "") +
      (chatError ? ", 채팅 되돌리기 오류" : "") +
      (mainManagerEmpty.length ? `, 메인 원장 비어 있음(${mainManagerEmpty.join(" · ")})` : ""),
  });

  const { notifyStaffChanges } = await import("@/lib/staff-change-notify");
  void notifyStaffChanges([{ kind: "unresign", userId: id, name: u.name, branch: u.branch }], { actorId: session.userId });

  return NextResponse.json({ ok: true, name: u.name, rejoined, trashedRooms, goneRooms, omitted, dmShown, chatError, mainManagerEmpty });
}
