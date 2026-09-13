import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { requestsTargetingWhere } from "@/lib/submission-targets";
import { serializeRequest } from "@/lib/submission-server";

export const dynamic = "force-dynamic";

// 내게 걸린 제출 요청 + 내 제출 여부 (본부 계정은 대상이 아니라 빈 목록)
export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, "submissions:read");
  if (a.ok === false) return a.res; // strictNullChecks 없이는 !a.ok 로 좁혀지지 않는다
  const { user } = a.p;
  if (user.role === "ADMIN") return NextResponse.json({ requests: [] });
  const status = new URL(request.url).searchParams.get("status") || "open";
  const statusWhere = status === "open" ? { closedAt: null } : status === "closed" ? { closedAt: { not: null } } : {};
  const rows = await prisma.submissionRequest.findMany({
    where: { ...statusWhere, ...requestsTargetingWhere(user) },
    include: { category: true },
    orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
    take: 200,
  });
  const mine = rows.length ? await prisma.submission.findMany({ where: { requestId: { in: rows.map((r) => r.id) }, userId: user.id, deletedAt: null }, select: { id: true, requestId: true } }) : [];
  const mineBy = new Map(mine.map((m) => [m.requestId, m.id]));
  return NextResponse.json({ requests: rows.map((r) => ({ ...serializeRequest(r), mySubmissionId: mineBy.get(r.id) ?? null })) });
}
