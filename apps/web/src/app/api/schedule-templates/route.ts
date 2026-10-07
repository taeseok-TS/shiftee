import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";
import { parseTemplateBody } from "@/lib/schedule-template";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// 근무일정 템플릿(2026-10-07 QA #10) — 목록(GET)·추가(POST, 본부). 고치기·끄기는 [id]/route.ts
// GET ?branch=지점 — 그 지점에서 쓸 수 있는 것(전사 공통 + 그 지점 전용)
//     branch 없이: 직원은 자기 지점, 원장은 담당 지점들, 본부는 전부. 본부는 ?all=1 로 꺼진 것까지

type Tpl = { id: string; code: string | null; name: string; startTime: string; endTime: string; branches: string[]; jobs: string[]; color: string | null; memo: string | null; sortOrder: number; isActive: boolean };
const shape = (t: Tpl) => ({ id: t.id, code: t.code, name: t.name, startTime: t.startTime, endTime: t.endTime, branches: t.branches, jobs: t.jobs, color: t.color, memo: t.memo, sortOrder: t.sortOrder, isActive: t.isActive });

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const all = sp.get("all") === "1" && session.role === "ADMIN";
  const branch = sp.get("branch")?.trim() || null;

  let scope: string[] | null;   // null = 지점 제한 없음(본부)
  if (branch) scope = [branch];
  else if (session.role === "ADMIN") scope = null;
  else if (session.role === "MANAGER") scope = await getManagerBranches(session.userId);
  else {
    const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { branch: true } });
    scope = me?.branch ? [me.branch] : [];
  }

  const rows = await prisma.scheduleTemplate.findMany({
    where: {
      ...(all ? {} : { isActive: true }),
      ...(scope ? { OR: [{ branches: { isEmpty: true } }, { branches: { hasSome: scope } }] } : {}),
    },
    orderBy: [{ startTime: "asc" }, { endTime: "asc" }, { sortOrder: "asc" }],
  });
  return NextResponse.json({ templates: rows.map(shape) });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  const p = parseTemplateBody(body);
  if (p.ok === false) return NextResponse.json({ error: p.error }, { status: 400 });
  const max = await prisma.scheduleTemplate.aggregate({ _max: { sortOrder: true } });
  const row = await prisma.scheduleTemplate.create({ data: { ...p.data, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "SCHEDULE_TEMPLATE_CREATE",
    targetType: "ScheduleTemplate", targetId: row.id, targetName: row.name,
    detail: `근무일정 템플릿 추가: ${row.name} ${row.startTime}~${row.endTime}${row.branches.length ? ` (${row.branches.join(", ")})` : " (전사 공통)"}`,
  });
  return NextResponse.json({ success: true, template: shape(row) });
}
