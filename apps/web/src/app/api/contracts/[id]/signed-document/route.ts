import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildSignedDocx, buildSignedPdf, firstFile, diskPath, type Signer } from "@/lib/signed-doc";

// Buffer 는 런타임상 Uint8Array 지만 NextResponse 의 BodyInit 타입과 안 맞는다.
// 복사 없이 같은 메모리를 가리키는 뷰로 넘긴다(큰 PDF 를 두 벌 만들지 않게).
const asBody = (b: Buffer) => new Uint8Array(b.buffer as ArrayBuffer, b.byteOffset, b.byteLength);

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

  // 문서별 정책은 lib/contract-access 에서 판정한다.
  // ⚠ 티켓(st)은 "당사자임"의 증명일 뿐 **정책 면제가 아니다**. 면제하면 앱이 받은 링크에서
  //   &inline=1 만 지워 열람 전용 문서를 받을 수 있다. 면제는 관리자 세션에만 준다.
  let viewOnly = false;
  if (session?.role !== "ADMIN") {
    const { canAccessContractFile } = await import("@/lib/contract-access");
    // 티켓만 온 요청(세션 없음)은 계약 당사자로 보고 정책만 확인한다 — 접근 자체는 위에서 허용됨
    const acc = await canAccessContractFile(
      { contractId: id },
      session ? { userId: session.userId, role: session.role } : { userId: contract.userId, role: "EMPLOYEE" }
    );
    if (!acc.allowed) return NextResponse.json({ error: acc.error }, { status: acc.status });
    viewOnly = acc.viewOnly;
  }
  if (viewOnly && new URL(_request.url).searchParams.get("inline") !== "1")
    return NextResponse.json({ error: "이 문서는 화면 열람만 가능합니다." }, { status: 403 });

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
  // 열람만 허용된 문서는 pdf=1 이 없어도 PDF 로 강제한다 — 종전에는 inline=1 만 붙이고
  // pdf=1 을 빼면 **서명.직인이 찍힌 워드 원본**이 그대로 나갔다(2026-09-02).
  // 앱이 받는 링크가 `?pdf=1&inline=1&st=...` 라 세 글자만 지우면 되는 상태였다.
  const wantPdf = viewOnly || reqUrl.searchParams.get("pdf") === "1";
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
            return new NextResponse(asBody(pdf), {
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
      // 열람만 허용된 문서는 워드로 폴백하지 않는다 — 브라우저가 못 그려 결국 저장되므로
      // "열람만"이 무너진다. original-document 와 같은 규칙(변환 실패면 실패시킨다).
      if (viewOnly)
        return NextResponse.json({ error: "지금은 문서를 열 수 없습니다. 잠시 후 다시 시도해주세요." }, { status: 503 });
      return new NextResponse(asBody(buf), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `${dispo}; filename*=UTF-8''${encodeURIComponent(contract.title + suffix + ".docx")}`,
        },
      });
    } else {
      const buf = await buildSignedPdf(orig ? diskPath(orig) : null, contract.title, signers);
      return new NextResponse(asBody(buf), {
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
