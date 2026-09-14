import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey, v1Error } from "@/lib/api-key";
import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/app-url";
import type { SubmissionFile } from "@/lib/submissions";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

// 큐브마케팅이 가져가는 마케팅 자료 목록 (회사 연동 키, marketing:read)
//  ?status=new(기본: 아직 발행 안 됨)|published|all   ?limit=50   ?cursor=<id>
//  ?since=<ISO>          그 뒤 **올라온** 것만 (createdAt 순)
//  ?updatedSince=<ISO>   그 뒤 **바뀐** 것만 (updatedAt 순) — 제목·파일 교체·발행·삭제 모두 updatedAt 이 움직인다 (요청 ③)
//  ?includeRemoved=1     삭제·동의 해제된 것도 removedAt 을 달아 준다(파일 없음) — 큐브마케팅이 "사용 중지" 로 돌릴 수 있게
//  동의 체크된 것만(includeRemoved 아니면). 파일 주소는 절대 URL — 같은 키(Authorization 헤더)로 받는다. files[].sha256 은 올릴 때 계산(옛 파일은 없음).
export async function GET(request: NextRequest) {
  const a = await authenticateApiKey(request, "marketing:read");
  if (a.ok === false) return a.res;
  if (a.p.key.kind !== "ORG") return v1Error(403, "회사 연동 키로만 쓸 수 있습니다.", "ORG_KEY_ONLY");
  const sp = new URL(request.url).searchParams;
  const status = sp.get("status") || "new";
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 50, 1), 200);
  const parseTs = (name: string, code: string): Date | null | NextResponse => {
    const raw = sp.get(name);
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? v1Error(400, `${name} 는 ISO 8601 시각이어야 합니다.`, code) : d;
  };
  const since = parseTs("since", "BAD_SINCE");
  if (since instanceof NextResponse) return since;
  const updatedSince = parseTs("updatedSince", "BAD_UPDATED_SINCE");
  if (updatedSince instanceof NextResponse) return updatedSince;
  const includeRemoved = sp.get("includeRemoved") === "1";
  const cursor = sp.get("cursor");

  const where: Prisma.SubmissionWhereInput = {
    category: { group: "MARKETING" },
    ...(includeRemoved ? {} : { deletedAt: null, consent: true }),
    ...(status === "new" ? { publishedAt: null } : status === "published" ? { publishedAt: { not: null } } : {}),
    ...(since ? { createdAt: { gt: since } } : {}),
    ...(updatedSince ? { updatedAt: { gt: updatedSince } } : {}),
  };
  const rows = await prisma.submission.findMany({
    where, include: { category: true },
    orderBy: updatedSince ? [{ updatedAt: "asc" }, { id: "asc" }] : [{ createdAt: "asc" }, { id: "asc" }],
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });
  const more = rows.length > limit;
  const page = more ? rows.slice(0, limit) : rows;
  const base = getAppUrl();
  return NextResponse.json({
    materials: page.map((s) => {
      const removedAt = s.deletedAt ?? (s.consent ? null : s.updatedAt);
      return {
        id: s.id,
        title: s.title,
        description: s.memo,
        category: { id: s.category.id, name: s.category.name },
        branch: s.userBranch,
        uploader: { name: s.userName, jobGroup: s.userJobGroup, position: s.userPosition },
        yearMonth: s.yearMonth,
        consent: s.consent,
        // 삭제·동의 해제된 자료는 파일을 주지 않는다(서빙 라우트도 404)
        files: removedAt ? [] : ((Array.isArray(s.files) ? s.files : []) as SubmissionFile[]).map((f) => ({ ...f, url: base + f.url })),
        publishedAt: s.publishedAt,
        publishedUrl: s.publishedUrl,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        removedAt,
      };
    }),
    nextCursor: more ? page[page.length - 1].id : null,
  });
}
