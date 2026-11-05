import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decodeFileName, extOf, magicMatches } from "@/lib/submissions";
import {
  isMedicalTemplateName, medicalState, medicalViewer, saveMedicalFile, forClient, sniffMime,
  MEDICAL_EXT, MEDICAL_MAX_BYTES, MEDICAL_MAX_FILES,
} from "@/lib/contract-medical";

// 임신기 신청서 진단서 첨부(#242, lib/contract-medical)
//  GET  — 본부·본인·재무 열람 계정: { required, attachments[], reapply, canUpload, canDelete } / 결재자·그 밖에 문서를 볼 수 있는 사람: { required, count, reapply } 만(파일·이름 없음)
//  POST — multipart file 하나. 본부는 언제든, 본인은 자기 서명 전(발송·진행 중)만
async function load(id: string) {
  return prisma.contract.findUnique({
    where: { id },
    select: {
      id: true, userId: true, status: true, isTest: true, externalName: true, template: { select: { name: true } },
      approvalLine: { select: { steps: { select: { approverId: true, status: true } } } },
    },
  });
}
type Loaded = NonNullable<Awaited<ReturnType<typeof load>>>;

// 본인이 아직 서명하지 않았고 계약이 진행 중일 때만 본인이 올린다 — 서명이 끝난 뒤에 붙이면 서명한 내용과 어긋난다
function ownerMayUpload(c: Loaded) {
  if (c.status !== "SENT" && c.status !== "APPROVED") return false;
  const mine = (c.approvalLine?.steps || []).filter((s) => s.approverId === c.userId);
  return mine.length > 0 && mine.some((s) => s.status !== "APPROVED");
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const c = await load(id);
  if (!c) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  const required = !c.externalName && isMedicalTemplateName(c.template?.name);
  const isAdmin = session.role === "ADMIN";
  const isOwner = c.userId === session.userId;
  const viewer = await medicalViewer(session, c);   // 재무 열람 계정도 목록·열기(2026-11-05 디렉터), 올리기·지우기는 없음
  // 접근 확인을 대상 판정보다 먼저 — 먼저 답하면 남의 계약 id 로 「임신기 신청서인지」(=임신 사실)를 알아낼 수 있었다(11/5 검증 3)
  const isApprover = (c.approvalLine?.steps || []).some((s) => s.approverId === session.userId);
  if (!viewer && !isApprover) {
    const { canAccessContractFile } = await import("@/lib/contract-access");
    const acc = await canAccessContractFile({ contractId: id }, { userId: session.userId, role: session.role });
    if (!acc.allowed) return NextResponse.json({ error: acc.error }, { status: acc.status });
  }
  if (!required) return NextResponse.json({ required: false });
  const st = await medicalState(id);
  if (viewer) {
    return NextResponse.json({
      required, reapply: st.reapply, attachments: st.attachments.map(forClient),
      canUpload: (isAdmin || (isOwner && ownerMayUpload(c))) && st.attachments.length < MEDICAL_MAX_FILES,
      canDelete: isAdmin, maxFiles: MEDICAL_MAX_FILES,
    });
  }
  // 결재자(원장 등)·지점 문서를 볼 수 있는 사람 — 표시만(이예지 11/5 「원장 결재 화면에는 진단서 첨부됨 표시만」)
  return NextResponse.json({ required, count: st.attachments.length, reapply: st.reapply });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id } = await params;
  const c = await load(id);
  if (!c) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  const isAdmin = session.role === "ADMIN";
  // 본인·본부 확인이 대상 판정보다 먼저 — 순서가 반대면 400/403 차이로 남의 계약이 임신기 신청서인지 드러난다(11/5 재검증)
  if (!isAdmin && c.userId !== session.userId) return NextResponse.json({ error: "본인 신청서에만 올릴 수 있습니다." }, { status: 403 });
  if (c.externalName || !isMedicalTemplateName(c.template?.name))
    return NextResponse.json({ error: "진단서를 첨부하는 서류가 아닙니다." }, { status: 400 });
  if (!isAdmin) {
    if (!ownerMayUpload(c)) return NextResponse.json({ error: "서명을 마친 뒤에는 올릴 수 없습니다. 추가로 낼 서류는 본부에 보내 주세요." }, { status: 409 });
  }
  const st = await medicalState(id);
  if (st.attachments.length >= MEDICAL_MAX_FILES)
    return NextResponse.json({ error: `진단서는 ${MEDICAL_MAX_FILES}개까지 올릴 수 있습니다.` }, { status: 400 });

  // 머리글로 먼저 거른다 — formData() 해석을 아낄 뿐, 본문은 proxy(src/proxy.ts)가 이미 다 받아 둔 뒤다(상한 110MB). 머리글이 없으면 아래 file.size 로 본다
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > MEDICAL_MAX_BYTES + 512 * 1024) return NextResponse.json({ error: "파일당 10MB 이하만 올릴 수 있습니다." }, { status: 413 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
  const name = decodeFileName((file.name || "진단서").trim()).slice(0, 120) || "진단서";
  const ext = extOf(name);
  if (!MEDICAL_EXT.has(ext)) return NextResponse.json({ error: "PDF · JPG · PNG · HEIC(아이폰 사진) 파일만 올릴 수 있습니다." }, { status: 400 });
  if (file.size > MEDICAL_MAX_BYTES) return NextResponse.json({ error: "파일당 10MB 이하만 올릴 수 있습니다." }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (!buf.length) return NextResponse.json({ error: "빈 파일입니다." }, { status: 400 });
  // 실제 형식은 앞 바이트로 — 사진은 확장자와 내용이 어긋나는 일이 잦다(아이폰 앨범이 IMG_0001.HEIC 이름으로 JPEG 를 건넨다). 사진끼리는 내용을 따른다
  const head = new Uint8Array(buf.subarray(0, 16));
  const mime = sniffMime(head, "");
  const isImg = (m: string) => m === "image/jpeg" || m === "image/png" || m === "image/heic";
  const ok = ext === ".pdf" ? magicMatches(".pdf", head) : isImg(mime) && (mime !== "image/heic" || magicMatches(".heic", head));
  if (!ok) return NextResponse.json({ error: "파일 내용이 확장자와 다릅니다. 원본 파일을 다시 골라 주세요." }, { status: 400 });
  const realExt = mime === "application/pdf" ? ".pdf" : mime === "image/png" ? ".png" : mime === "image/heic" ? ".heic" : ".jpg";
  try {
    const att = await saveMedicalFile({ contractId: id, buf, name, ext: realExt, mime, actorId: session.userId, actorName: session.name, byAdmin: isAdmin, request });
    if (!att) return NextResponse.json({ error: `진단서는 ${MEDICAL_MAX_FILES}개까지 올릴 수 있습니다.` }, { status: 400 });
    return NextResponse.json({ attachment: forClient(att) });
  } catch (e) {
    console.error("[contract-medical] 첨부 저장 실패:", id, e);
    return NextResponse.json({ error: "진단서를 저장하지 못했습니다. 다시 시도해 주세요." }, { status: 500 });
  }
}
