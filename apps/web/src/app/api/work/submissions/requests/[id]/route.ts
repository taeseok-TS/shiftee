import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { resolveSubmissionViewer } from "@/lib/submission-access";
import { isTargeted, targetLabel, targetUsersFor } from "@/lib/submission-targets";
import { pickBranches, pickJobGroups, pickTargetUsers, serializeRequest, serializeSubmission } from "@/lib/submission-server";
import { parseDateStr, dateStr } from "@/lib/submissions";

export const dynamic = "force-dynamic";

// 요청 상세 = 현황표. 본부는 전 지점, 원장은 담당 지점만, 직원은 요청 정보와 내 제출만.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const v = await resolveSubmissionViewer(session, null);
  if (!v) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const r = await prisma.submissionRequest.findUnique({ where: { id }, include: { category: true } });
  if (!r) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });

  if (v.role === "EMPLOYEE") {
    if (!isTargeted(v, r)) return NextResponse.json({ error: "이 요청의 대상이 아닙니다." }, { status: 403 });
    const mine = await prisma.submission.findFirst({ where: { requestId: id, userId: v.userId, deletedAt: null }, include: { category: true } });
    return NextResponse.json({ request: serializeRequest(r), mine: mine ? serializeSubmission(mine) : null });
  }

  const targets = (await targetUsersFor(r)).filter((u) => v.role === "ADMIN" || (u.branch && v.branches.includes(u.branch)));
  const subs = await prisma.submission.findMany({
    where: { requestId: id, deletedAt: null, ...(v.role === "MANAGER" ? { userBranch: { in: v.branches } } : {}) },
    include: { category: true },
    orderBy: { createdAt: "desc" },
  });
  const subByUser = new Map(subs.map((s) => [s.userId, s]));
  // 지점별 묶음 — 대상자 기준(제출했지만 지금은 대상이 아닌 사람도 목록엔 나온다)
  const branches = new Map<string, { branch: string; targets: number; submitted: number; missing: { id: string; name: string; jobGroup: string | null }[] }>();
  for (const t of targets) {
    const key = t.branch ?? "(지점 없음)";
    if (!branches.has(key)) branches.set(key, { branch: key, targets: 0, submitted: 0, missing: [] });
    const b = branches.get(key)!;
    b.targets++;
    if (subByUser.has(t.id)) b.submitted++;
    else b.missing.push({ id: t.id, name: t.name, jobGroup: t.jobGroup });
  }
  const targetIds = new Set(targets.map((t) => t.id));
  return NextResponse.json({
    request: serializeRequest(r),
    summary: { targets: targets.length, submitted: targets.filter((t) => subByUser.has(t.id)).length, extra: subs.filter((s) => !targetIds.has(s.userId)).length },
    branches: [...branches.values()].sort((a, b) => a.branch.localeCompare(b.branch, "ko")),
    submissions: subs.map(serializeSubmission),
  });
}

// 요청 수정·닫기 (본부만)
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부 관리자만 요청을 바꿀 수 있습니다." }, { status: 403 });
  const { id } = await params;
  const cur = await prisma.submissionRequest.findUnique({ where: { id } });
  if (!cur) return NextResponse.json({ error: "요청을 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json().catch(() => ({}));
  const data: Record<string, unknown> = {};
  const changes: string[] = [];
  if (typeof body.title === "string") {
    const t = body.title.trim().slice(0, 120);
    if (!t) return NextResponse.json({ error: "제목을 입력해주세요." }, { status: 400 });
    if (t !== cur.title) { data.title = t; changes.push(`제목 ${cur.title}→${t}`); }
  }
  if (typeof body.description === "string") {
    const desc = body.description.trim().slice(0, 2000) || null;
    if (desc !== cur.description) { data.description = desc; changes.push("안내문"); }
  }
  if (typeof body.categoryId === "string" && body.categoryId !== cur.categoryId) {
    const c = await prisma.submissionCategory.findUnique({ where: { id: body.categoryId } });
    if (!c || !c.active) return NextResponse.json({ error: "분류가 올바르지 않습니다." }, { status: 400 });
    data.categoryId = c.id; changes.push(`분류 ${c.name}`);
  }
  // 받는 사람 — 사람을 콕 집으면 직군·지점은 비우고, 직군·지점으로 바꾸면 사람 지정은 비운다(섞지 않는다)
  let picked: Awaited<ReturnType<typeof pickTargetUsers>> = null;
  if (body.targetUserIds !== undefined) {
    picked = await pickTargetUsers(body.targetUserIds);
    if (!picked) return NextResponse.json({ error: "받는 사람이 올바르지 않습니다(퇴사자·본부는 넣을 수 없습니다)." }, { status: 400 });
    const same = picked.ids.length === cur.targetUserIds.length && picked.ids.every((x) => cur.targetUserIds.includes(x));
    if (!same) {
      data.targetUserIds = picked.ids;
      if (picked.ids.length) { data.targetJobGroups = []; data.targetBranches = []; }
      changes.push(`대상 ${picked.ids.length ? targetLabel({ targetJobGroups: [], targetBranches: [], targetUserIds: picked.ids }, picked.users.map((u) => u.name)) : "직접 지정 해제"}`);
    }
  }
  const peopleMode = picked ? picked.ids.length > 0 : cur.targetUserIds.length > 0;
  if (!peopleMode && body.targetJobGroups !== undefined) {
    const g = pickJobGroups(body.targetJobGroups);
    if (!g) return NextResponse.json({ error: "대상 직군이 올바르지 않습니다." }, { status: 400 });
    if (g.join("|") !== cur.targetJobGroups.join("|") || cur.targetUserIds.length) { data.targetJobGroups = g; changes.push(`대상 직군 ${g.length ? g.join("/") : "전 직군"}`); }
  }
  if (!peopleMode && body.targetBranches !== undefined) {
    const b = await pickBranches(body.targetBranches);
    if (!b) return NextResponse.json({ error: "대상 지점이 올바르지 않습니다." }, { status: 400 });
    if (b.join("|") !== cur.targetBranches.join("|") || cur.targetUserIds.length) { data.targetBranches = b; changes.push(`대상 지점 ${b.length ? b.join("/") : "전 지점"}`); }
  }
  if (body.dueDate !== undefined) {
    if (body.dueDate === null || body.dueDate === "") { if (cur.dueDate) { data.dueDate = null; data.remindedAt = null; data.overdueNotifiedAt = null; changes.push("마감 없음"); } }
    else {
      const d = parseDateStr(body.dueDate);
      if (!d) return NextResponse.json({ error: "마감일이 올바르지 않습니다." }, { status: 400 });
      if (dateStr(d) !== dateStr(cur.dueDate)) {
        data.dueDate = d; changes.push(`마감 ${dateStr(cur.dueDate) ?? "없음"}→${body.dueDate}`);
        // 마감이 바뀌면 독촉을 다시 보낼 수 있게 표시를 지운다
        data.remindedAt = null; data.overdueNotifiedAt = null;
      }
    }
  }
  if (typeof body.closed === "boolean") {
    const wasClosed = !!cur.closedAt;
    if (body.closed !== wasClosed) { data.closedAt = body.closed ? new Date() : null; changes.push(body.closed ? "닫음" : "다시 엶"); }
  }
  if (!changes.length) return NextResponse.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });
  // 바뀐 뒤 받는 사람이 0명이면 막는다(POST 와 같은 규칙 — 화면은 미리보기로 막지만 API 직접 호출 대비)
  const after = {
    targetJobGroups: (data.targetJobGroups as string[] | undefined) ?? cur.targetJobGroups,
    targetBranches: (data.targetBranches as string[] | undefined) ?? cur.targetBranches,
    targetUserIds: (data.targetUserIds as string[] | undefined) ?? cur.targetUserIds,
  };
  if (data.targetJobGroups !== undefined || data.targetBranches !== undefined || data.targetUserIds !== undefined) {
    if (!(await targetUsersFor(after)).length) return NextResponse.json({ error: "이 조건에 맞는 직원이 없습니다. 받는 사람을 다시 골라주세요." }, { status: 400 });
  }
  const row = await prisma.submissionRequest.update({ where: { id }, data, include: { category: true } });
  await logAudit({ actorId: session.userId, actorName: session.name, action: "SUBMISSION_REQUEST_UPDATE", targetType: "SUBMISSION_REQUEST", targetId: id, targetName: row.title, detail: changes.join(", ") });
  // 받는 사람이 새로 추가됐고 요청이 열려 있으면 그 사람들에게만 "내야 할 자료" DM (기존 대상자는 다시 받지 않는다)
  if (data.targetUserIds !== undefined && !row.closedAt) {
    const before = new Set(cur.targetUserIds.length ? cur.targetUserIds : (await targetUsersFor(cur)).map((u) => u.id));
    const added = (data.targetUserIds as string[]).filter((x) => !before.has(x));
    if (added.length) { const { notifyRequestCreated } = await import("@/lib/submission-notify"); void notifyRequestCreated(id, added); }
  }
  return NextResponse.json({ request: serializeRequest(row) });
}
