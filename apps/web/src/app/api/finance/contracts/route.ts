import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isContractViewer } from "@/lib/contract-viewer";
import type { Prisma } from "@prisma/client";
import { isMedicalTemplateName } from "@/lib/contract-medical";

export const dynamic = "force-dynamic";

// 재무팀 전자계약 열람 전용 — 전 직원 계약서 목록(2026-11-02 디렉터 회의 5번, lib/contract-viewer)
//  · 초안 · 시험 문서는 뺀다. 계약 내용(입력값) · 결재선 · 서명 이미지는 싣지 않는다 — 목록과 PDF 로만 본다
//  · ?status=signed(기본) | progress | all · ?q=이름·서류 이름 · ?year=YYYY(작성 연도, KST) · ?branch=지점
const PROGRESS = ["SENT", "APPROVED"] as const;
const LIMIT = 500;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (!(await isContractViewer(session))) return NextResponse.json({ error: "전자계약 열람 권한이 없습니다." }, { status: 403 });

  const sp = new URL(request.url).searchParams;
  const status = sp.get("status") || "signed";
  const q = (sp.get("q") || "").trim();
  const year = Number(sp.get("year"));
  const branch = (sp.get("branch") || "").trim();

  const and: Prisma.ContractWhereInput[] = [{ isTest: false }, { status: { not: "DRAFT" } }];
  if (status === "signed") and.push({ status: "SIGNED" });
  else if (status === "progress") and.push({ status: { in: [...PROGRESS] } });
  if (Number.isInteger(year) && year >= 2000 && year <= 2100) {
    // 연 경계는 KST 자정(서버 UTC) — api/contracts GET 과 같은 규칙
    const kst = (y: number) => new Date(Date.UTC(y, 0, 1) - 9 * 3600 * 1000);
    and.push({ createdAt: { gte: kst(year), lt: kst(year + 1) } });
  }
  // 외부 계약의 user 는 작성한 관리자라 지점 · 이름 찾기에서 뺀다(api/contracts GET 과 같게)
  if (branch) and.push({ externalName: null, user: { branch } });
  if (q) {
    const m = { contains: q, mode: "insensitive" as const };
    and.push({ OR: [{ title: m }, { externalName: m }, { externalName: null, user: { name: m } }] });
  }

  const where: Prisma.ContractWhereInput = { AND: and };
  // 지점 고르기 목록도 같이 준다 — /api/branches 는 직원 역할에 막혀 있다
  const [rows, total, branchRows] = await Promise.all([
    prisma.contract.findMany({
      where,
      select: {
        id: true, title: true, status: true, createdAt: true, signedAt: true, docNo: true, externalName: true, template: { select: { name: true } },
        user: { select: { name: true, branch: true, empNo: true, employmentStatus: true } },
      },
      orderBy: [{ signedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: LIMIT,
    }),
    prisma.contract.count({ where }),
    prisma.branch.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  const lockedPdf = await (await import("@/lib/contract-locked")).lockedPdfIds();
  return NextResponse.json(
    {
      total,
      branches: branchRows.map((b) => b.name),
      limit: LIMIT,
      contracts: rows.map((c) => ({
        pdfLocked: lockedPdf.has(c.id),   // 비밀번호가 걸린 이관본 — 열람 계정은 못 연다(lib/contract-locked)
        medical: !c.externalName && isMedicalTemplateName(c.template?.name),   // 임신기 신청서 — 진단서 보기 단추(#242, 2026-11-05 디렉터)
        id: c.id, title: c.title, status: c.status, createdAt: c.createdAt, signedAt: c.signedAt, docNo: c.docNo,
        name: c.externalName ?? c.user.name,
        branch: c.externalName ? null : c.user.branch,
        empNo: c.externalName ? null : c.user.empNo,
        external: !!c.externalName,
        resigned: !c.externalName && c.user.employmentStatus === "RESIGNED",
      })),
    },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
