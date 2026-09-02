import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildSignedDocx, buildSignedPdf, firstFile, diskPath, type Signer } from "@/lib/signed-doc";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  // ?st= 계약 바인딩 단기 티켓 — 앱이 외부 브라우저로 열 때(세션 못 실음). 권한은 발급 API에서 검증됨
  const { verifySignedDocTicket } = await import("@/lib/upload-ticket");
  const st = new URL(_request.url).searchParams.get("st");
  const ticketOk = verifySignedDocTicket(id, st);
  const session = ticketOk ? null : await getSession();
  if (!ticketOk && !session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const contract = await prisma.contract.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, branch: true } },
      approvalLine: { include: { steps: { orderBy: { order: "asc" }, include: { approver: { select: { name: true, role: true } } } } } },
    },
  });
  if (!contract) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });

  // 권한: 관리자 / 계약 당사자 본인 (원장 등 결재자는 서명본 보관 불가 — 개인정보 보호).
  // 계약 단위 티켓(st)은 발급 때 이미 권한을 확인했으므로 통과시킨다.
  const allowed = ticketOk || session!.role === "ADMIN" || contract.userId === session!.userId;
  if (!allowed) return NextResponse.json({ error: "서명 완료본은 관리자와 계약 당사자만 받을 수 있습니다." }, { status: 403 });

  // #129 서명 완료 후 문서별 근로자 접근 — 템플릿 설정(postSignAccess)에 따라 당사자 접근 제한.
  // 완료본(SIGNED)에만 적용 — 진행 중 열람(#110)은 본인 확인용이라 현행 허용.
  // ⚠ 티켓(st)도 정책을 면제받지 않는다. 티켓은 "권한 검증을 통과한 요청"이라는 증명일 뿐이라,
  //   면제하면 앱이 받은 링크에서 &inline=1 만 지워 열람 전용 문서를 받을 수 있다 (2026-09-02).
  //   면제는 관리자 세션에만 준다.
  if (session?.role !== "ADMIN" && contract.status === "SIGNED" && contract.templateId) {
    const tmpl = await prisma.contractTemplate.findUnique({
      where: { id: contract.templateId },
      select: { postSignAccess: true },
    });
    const access = tmpl?.postSignAccess || "full";
    if (access === "none")
      return NextResponse.json({ error: "이 문서는 제출 완료 상태로, 사본이 필요하면 관리자에게 요청해주세요." }, { status: 403 });
    if (access === "view" && new URL(_request.url).searchParams.get("inline") !== "1")
      return NextResponse.json({ error: "이 문서는 화면 열람만 가능합니다." }, { status: 403 });
  }

  // 진행 중 계약도 지금까지 된 서명을 반영해 보여준다 (#110, 2026-08-27) — 서명이 하나도 없으면 안내
  const inProgress = contract.status !== "SIGNED";

  // 서명자 목록 구성
  const steps = contract.approvalLine?.steps || [];
  const signers: Signer[] = [];
  for (const st of steps) {
    if (!st.signatureUrl) continue;
    // 외부(미가입) 서명 단계는 approver가 없음 — 외부 계약자 = 근로자 서명으로 취급.
    // 외부 계약은 소유자=작성 관리자 — 관리자 결재 스텝을 직원 서명으로 오인하면 직인 누락
    const isEmployeeStep = st.approverId
      ? st.approverId === contract.userId && !contract.externalName
      : true;
    signers.push({
      label: isEmployeeStep ? "직원 서명" : `${st.order}단계 결재`,
      name: st.approver?.name || st.externalName || "외부 서명자",
      date: st.decidedAt,
      sigPath: diskPath(st.signatureUrl),
      role: isEmployeeStep ? null : (st.approver as { role?: string } | null)?.role ?? null,
    });
  }
  if (signers.length === 0)
    return NextResponse.json({ error: inProgress ? "아직 서명이 없습니다." : "서명 정보가 없습니다." }, { status: 400 });
  const suffix = inProgress ? "_서명진행본" : "_서명완료";

  const orig = firstFile(contract.fileUrl);
  const isDocx = !!orig && orig.toLowerCase().endsWith(".docx");

  // ?pdf=1 — 워드 완료본을 PDF로 변환해 제공 (개선 제안 2026-08-24: 다운로드 후 수정 방지).
  // 변환기(gotenberg)가 죽어 있으면 워드로 폴백해 다운로드 자체는 항상 된다.
  const reqUrl = new URL(_request.url);
  const wantPdf = reqUrl.searchParams.get("pdf") === "1";
  // inline=1 — 저장(다운로드) 대신 브라우저 탭에서 바로 열람 (미리보기 용도)
  const dispo = reqUrl.searchParams.get("inline") === "1" ? "inline" : "attachment";

  try {
    if (isDocx) {
      const buf = await buildSignedDocx(diskPath(orig!), contract.title, signers);
      if (wantPdf) {
        try {
          const fd = new FormData();
          fd.append("files", new Blob([new Uint8Array(buf)]), "document.docx");
          const gres = await fetch(
            `${process.env.GOTENBERG_URL || "http://gotenberg:3000"}/forms/libreoffice/convert`,
            { method: "POST", body: fd }
          );
          if (gres.ok) {
            const pdf = Buffer.from(await gres.arrayBuffer());
            return new NextResponse(pdf, {
              headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `${dispo}; filename*=UTF-8''${encodeURIComponent(contract.title + suffix + ".pdf")}`,
              },
            });
          }
          console.error("PDF 변환 실패(gotenberg):", gres.status, await gres.text().catch(() => ""));
        } catch (e) {
          console.error("PDF 변환 오류(gotenberg):", e);
        }
      }
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `${dispo}; filename*=UTF-8''${encodeURIComponent(contract.title + suffix + ".docx")}`,
        },
      });
    } else {
      const buf = await buildSignedPdf(orig ? diskPath(orig) : null, contract.title, signers);
      return new NextResponse(buf, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${dispo}; filename*=UTF-8''${encodeURIComponent(contract.title + suffix + ".pdf")}`,
        },
      });
    }
  } catch (e) {
    console.error("서명본 생성 오류:", e);
    return NextResponse.json({ error: "서명본 생성 중 오류가 발생했습니다." }, { status: 500 });
  }
}
