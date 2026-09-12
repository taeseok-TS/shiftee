import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveSubmissionViewer } from "@/lib/submission-access";
import { requestsTargetingWhere } from "@/lib/submission-targets";

export const dynamic = "force-dynamic";

// 사이드바 뱃지 — 내게 걸린 열린 요청 중 아직 안 낸 수. 본부는 0(대상이 아니다). 순수 GET.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const v = await resolveSubmissionViewer(session, null);
  if (!v || v.role === "ADMIN") return NextResponse.json({ pending: 0 });
  const reqs = await prisma.submissionRequest.findMany({ where: { closedAt: null, ...requestsTargetingWhere(v) }, select: { id: true } });
  if (!reqs.length) return NextResponse.json({ pending: 0 });
  const done = await prisma.submission.findMany({ where: { requestId: { in: reqs.map((r) => r.id) }, userId: v.userId, deletedAt: null }, select: { requestId: true } });
  const doneSet = new Set(done.map((d) => d.requestId));
  return NextResponse.json({ pending: reqs.filter((r) => !doneSet.has(r.id)).length });
}
