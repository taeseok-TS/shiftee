import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { resolveSubmissionViewer } from "@/lib/submission-access";
import { eligibleTargetWhere, isTargeted, requestsTargetingWhere, targetLabel, targetUsersFor } from "@/lib/submission-targets";
import { pickBranches, pickJobGroups, pickTargetUsers, serializeRequest } from "@/lib/submission-server";
import { parseDateStr } from "@/lib/submissions";

export const dynamic = "force-dynamic";

// 제출 요청 목록
//  - 직원·원장(기본): 내게 걸린 요청 + 내 제출 여부 (?status=open|closed|all, 기본 open)
//  - 본부 / 원장 ?scope=manage: 요청 전체(원장은 담당 지점 대상 요청만) + 제출 집계
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const v = await resolveSubmissionViewer(session, null);
  if (!v) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const status = sp.get("status") || "open";
  const statusWhere = status === "open" ? { closedAt: null } : status === "closed" ? { closedAt: { not: null } } : {};
  const manage = sp.get("scope") === "manage" && v.role !== "EMPLOYEE";

  if (manage) {
    // 대상자·제출자 집계 — 사람 목록은 한 번만 읽고 요청마다 메모리에서 거른다
    const everyone = await targetUsersFor({ targetJobGroups: [], targetBranches: [] });
    const pool = v.role === "MANAGER" ? everyone.filter((u) => u.branch && v.branches.includes(u.branch)) : everyone;
    const rows = await prisma.submissionRequest.findMany({
      where: {
        ...statusWhere,
        // 원장: 담당 지점이 대상에 들어가는 요청만(전 지점 요청 포함). 사람을 콕 집은 요청은 담당 지점 사람이 하나라도 있을 때
        ...(v.role === "MANAGER"
          ? { OR: [
              { targetUserIds: { isEmpty: true }, OR: [{ targetBranches: { isEmpty: true } }, { targetBranches: { hasSome: v.branches } }] },
              ...(pool.length ? [{ targetUserIds: { hasSome: pool.map((u) => u.id) } }] : []),
            ] }
          : {}),
      },
      include: { category: true },
      orderBy: [{ closedAt: { sort: "asc", nulls: "first" } }, { dueDate: "asc" }, { createdAt: "desc" }], // 열린 요청 먼저
      take: 200,
    });
    const subs = rows.length
      ? await prisma.submission.findMany({ where: { requestId: { in: rows.map((r) => r.id) }, deletedAt: null }, select: { requestId: true, userId: true } })
      : [];
    const subBy = new Map<string, Set<string>>();
    for (const s of subs) {
      if (!s.requestId) continue;
      if (!subBy.has(s.requestId)) subBy.set(s.requestId, new Set());
      subBy.get(s.requestId)!.add(s.userId);
    }
    return NextResponse.json({
      requests: rows.map((r) => {
        const targets = pool.filter((u) => isTargeted({ id: u.id, role: "EMPLOYEE", branch: u.branch, jobGroup: u.jobGroup }, r));
        const done = subBy.get(r.id) ?? new Set<string>();
        const submitted = targets.filter((t) => done.has(t.id)).length;
        // 직접 지정이면 이름 몇 개를 같이 실어 목록에 "직접 지정 7명 (김○○·이○○·박○○ 외 4명)" 로 보인다
        const names = r.targetUserIds.length ? everyone.filter((u) => r.targetUserIds.includes(u.id)).map((u) => u.name) : [];
        return { ...serializeRequest(r), targetCount: targets.length, submittedCount: submitted, targetLabel: targetLabel(r, names) };
      }),
    });
  }

  // 내게 걸린 요청 (본부는 대상이 아니므로 빈 목록)
  if (v.role === "ADMIN") return NextResponse.json({ requests: [] });
  const rows = await prisma.submissionRequest.findMany({
    where: { ...statusWhere, ...requestsTargetingWhere(v) },
    include: { category: true },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  const mine = rows.length
    ? await prisma.submission.findMany({ where: { requestId: { in: rows.map((r) => r.id) }, userId: v.userId, deletedAt: null }, select: { id: true, requestId: true, createdAt: true } })
    : [];
  const mineBy = new Map(mine.map((m) => [m.requestId, m]));
  return NextResponse.json({
    requests: rows.map((r) => {
      const m = mineBy.get(r.id);
      return { ...serializeRequest(r), mySubmissionId: m?.id ?? null, mySubmittedAt: m?.createdAt ?? null };
    }),
  });
}

// 제출 요청 걸기 (본부만) → 대상자 봇 DM
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부 관리자만 제출 요청을 걸 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 2000) : "";
  if (!title) return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
  const category = typeof body.categoryId === "string" ? await prisma.submissionCategory.findUnique({ where: { id: body.categoryId } }) : null;
  if (!category || !category.active) return NextResponse.json({ error: "분류를 선택해주세요." }, { status: 400 });
  if (category.group === "MARKETING") return NextResponse.json({ error: "마케팅 자료는 제출 요청 대상이 아닙니다(자유 올리기만)." }, { status: 400 });
  const targetJobGroups = pickJobGroups(body.targetJobGroups);
  if (!targetJobGroups) return NextResponse.json({ error: "대상 직군이 올바르지 않습니다." }, { status: 400 });
  const targetBranches = await pickBranches(body.targetBranches);
  if (!targetBranches) return NextResponse.json({ error: "대상 지점이 올바르지 않습니다." }, { status: 400 });
  const picked = await pickTargetUsers(body.targetUserIds);
  if (!picked) return NextResponse.json({ error: "받는 사람이 올바르지 않습니다(퇴사자·본부는 넣을 수 없습니다)." }, { status: 400 });
  const targetUserIds = picked.ids;
  // 사람을 콕 집었으면 직군·지점은 비운다 — 두 방식을 섞지 않는다
  const spec = targetUserIds.length
    ? { targetJobGroups: [] as string[], targetBranches: [] as string[], targetUserIds }
    : { targetJobGroups, targetBranches, targetUserIds: [] as string[] };
  if (!targetUserIds.length) {
    // 아무도 해당되지 않는 조건(예: 본부 지점만)으로 걸리면 DM 도 현황도 비어 헛돈다
    const n = await prisma.user.count({ where: { ...eligibleTargetWhere(), ...(targetJobGroups.length ? { jobGroup: { in: targetJobGroups } } : {}), ...(targetBranches.length ? { branch: { in: targetBranches } } : {}) } });
    if (!n) return NextResponse.json({ error: "이 조건에 맞는 직원이 없습니다. 직군·지점을 다시 골라주세요." }, { status: 400 });
  }
  let dueDate: Date | null = null;
  if (body.dueDate) {
    dueDate = parseDateStr(body.dueDate);
    if (!dueDate) return NextResponse.json({ error: "마감일이 올바르지 않습니다." }, { status: 400 });
  }
  const row = await prisma.submissionRequest.create({
    data: { title, description: description || null, categoryId: category.id, ...spec, dueDate, createdBy: session.userId, createdByName: session.name },
    include: { category: true },
  });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "SUBMISSION_REQUEST_CREATE",
    targetType: "SUBMISSION_REQUEST", targetId: row.id, targetName: title,
    detail: `${category.name} · 대상 ${targetLabel(spec, picked.users.map((u) => u.name))} · 마감 ${body.dueDate || "없음"}`,
  });
  // 알림은 응답을 막지 않는다
  const { notifyRequestCreated } = await import("@/lib/submission-notify");
  void notifyRequestCreated(row.id);
  return NextResponse.json({ request: serializeRequest(row) });
}
