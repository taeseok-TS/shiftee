import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/app-url";
import type { SubmissionFile } from "@/lib/submissions";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// 큐브마케팅이 가져가는 마케팅 자료 목록 (회사 연동 키, marketing:read)
//  ?status=new(기본: 아직 발행 안 됨)|published|all  ?since=<ISO 시각: 그 뒤 올라온 것>  ?limit=50  ?cursor=<id>
//  동의 체크된 것만. 파일 주소는 절대 URL — 같은 키(Authorization 헤더)로 받는다.
export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, "marketing:read");
  if (a.ok === false) return a.res;
  if (a.p.key.kind !== "ORG") return v1Error(403, "회사 연동 키로만 쓸 수 있습니다.", "ORG_KEY_ONLY");
  const sp = new URL(request.url).searchParams;
  const status = sp.get("status") || "new";
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
  const since = sp.get("since") ? new Date(sp.get("since") as string) : null;
  if (since && isNaN(since.getTime())) return v1Error(400, "since 는 ISO 8601 시각이어야 합니다.", "BAD_SINCE");
  const cursor = sp.get("cursor");

  const where: Prisma.SubmissionWhereInput = {
    deletedAt: null, consent: true, category: { group: "MARKETING" },
    ...(status === "new" ? { publishedAt: null } : status === "published" ? { publishedAt: { not: null } } : {}),
    ...(since ? { createdAt: { gt: since } } : {}),
  };
  const rows = await prisma.submission.findMany({
    where, include: { category: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const base = getAppUrl();
  return NextResponse.json({
    materials: page.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.memo,
      category: { id: s.category.id, name: s.category.name },
      branch: s.userBranch,
      uploader: { name: s.userName, jobGroup: s.userJobGroup, position: s.userPosition },
      yearMonth: s.yearMonth,
      consent: s.consent,
      files: ((Array.isArray(s.files) ? s.files : []) as SubmissionFile[]).map((f) => ({ ...f, url: base + f.url })),
      publishedAt: s.publishedAt,
      publishedUrl: s.publishedUrl,
      createdAt: s.createdAt,
    })),
    nextCursor: more ? page[page.length - 1].id : null,
  });
}
