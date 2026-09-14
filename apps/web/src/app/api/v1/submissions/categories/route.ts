import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, "submissions:read");
  if (a.ok === false) return a.res; // strictNullChecks 없이는 !a.ok 로 좁혀지지 않는다
  // 마케팅 자료 유형은 키 경로에서 제출할 수 없으므로 목록에서도 뺀다
  const rows = await prisma.submissionCategory.findMany({ where: { active: true, group: { not: "MARKETING" } }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, group: true, name: true } });
  return NextResponse.json({ categories: rows });
}
