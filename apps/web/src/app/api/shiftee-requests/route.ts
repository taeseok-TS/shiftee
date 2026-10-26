import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { shifteeScopeWhere } from "@/lib/shiftee-request-scope";
import { kstDayStart, shifteeKindLabel, shifteeStatusLabel, shifteeSummary } from "@/lib/shiftee-request";

export const dynamic = "force-dynamic";

// 시프티 요청·승인 이력(보관) 목록(2026-10-26 디렉터 승인 「요청이력은 표+화면으로」) — **읽기 전용**, 감사 로그·DM 없음.
//  · 범위: ADMIN 전체 / MANAGER 담당 지점 / EMPLOYEE 본인(lib/shiftee-request-scope — 첨부 라우트와 같은 판정)
//  · q      : 이름·승인자·코멘트 부분 일치, 숫자만이면 요청번호 일치도
//  · kind · status · branch : 시프티 원문 코드·지점명 그대로
//  · from · to : KST 날짜("YYYY-MM-DD") — 신청일 기준, to 는 그날 끝까지
//  · page(1부터) · size(기본 50, 최대 200) · 최신순(requestedAt desc, id desc)
//  · facets=1 : 고르기 목록(지점·종류 — 표에 실제로 있는 값)만 돌려준다. 2021~2026 지점명은 지금 지점 표와 다를 수 있어 기록에서 뽑는다
const SIZE = 50;
const SIZE_MAX = 200;
const Q_MAX = 60;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const scope = await shifteeScopeWhere(session);

  if (sp.get("facets") === "1") {
    const [branches, kinds] = await Promise.all([
      prisma.shifteeRequest.groupBy({ by: ["branch"], where: scope, _count: { _all: true }, orderBy: { branch: "asc" } }),
      prisma.shifteeRequest.groupBy({ by: ["kind"], where: scope, _count: { _all: true }, orderBy: { _count: { kind: "desc" } } }),
    ]);
    return NextResponse.json({
      branches: branches.filter((b) => b.branch).map((b) => ({ name: b.branch as string, count: b._count._all })),
      kinds: kinds.map((k) => ({ key: k.kind, label: shifteeKindLabel(k.kind), count: k._count._all })),
    });
  }

  const q = (sp.get("q") || "").trim().slice(0, Q_MAX);
  const kind = (sp.get("kind") || "").trim();
  const status = (sp.get("status") || "").trim();
  const branch = (sp.get("branch") || "").trim();
  const fromRaw = (sp.get("from") || "").trim();
  const toRaw = (sp.get("to") || "").trim();
  // 숫자 아님·무한대(1e400)는 1·기본값으로(검증 지적 — Infinity 가 skip 으로 넘어가 500)
  const num = (v: string | null, dflt: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? n : dflt; };
  const page = num(sp.get("page"), 1);
  const size = Math.min(SIZE_MAX, num(sp.get("size"), SIZE));

  const and: Prisma.ShifteeRequestWhereInput[] = [scope];
  if (q) {
    const or: Prisma.ShifteeRequestWhereInput[] = [
      { name: { contains: q, mode: "insensitive" } },
      { approver: { contains: q, mode: "insensitive" } },
      { comment: { contains: q, mode: "insensitive" } },
    ];
    if (/^\d+$/.test(q)) or.push({ id: q });
    and.push({ OR: or });
  }
  if (kind) and.push({ kind });
  if (status) and.push({ status });
  if (branch) and.push({ branch });
  if (fromRaw) {
    const from = kstDayStart(fromRaw);
    if (!from) return NextResponse.json({ error: "from 은 YYYY-MM-DD 로 적어 주세요." }, { status: 400 });
    and.push({ requestedAt: { gte: from } });
  }
  if (toRaw) {
    const to = kstDayStart(toRaw);
    if (!to) return NextResponse.json({ error: "to 는 YYYY-MM-DD 로 적어 주세요." }, { status: 400 });
    and.push({ requestedAt: { lt: new Date(to.getTime() + 24 * 60 * 60 * 1000) } });   // 그날 끝까지
  }
  const where: Prisma.ShifteeRequestWhereInput = { AND: and };   // 범위 OR 와 검색 OR 가 서로 덮어쓰지 않게 AND 로 묶는다

  const [total, rows] = await Promise.all([
    prisma.shifteeRequest.count({ where }),
    prisma.shifteeRequest.findMany({
      where,
      orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * size,
      take: size,
      select: {
        id: true, userId: true, empNo: true, name: true, branch: true, kind: true, status: true, step: true, cancelled: true,
        requestedAt: true, content: true, approver: true, comment: true, attachments: true,
      },
    }),
  ]);

  return NextResponse.json({
    rows: rows.map((r) => ({
      ...r,
      requestedAt: r.requestedAt.toISOString(),
      kindLabel: shifteeKindLabel(r.kind),
      statusLabel: shifteeStatusLabel(r.status),
      summary: shifteeSummary(r.kind, r.content),
    })),
    total, page, size, pages: Math.max(1, Math.ceil(total / size)),
  });
}
