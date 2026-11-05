import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { medicalState, medicalDir, sniffMime, removeMedicalFile } from "@/lib/contract-medical";

// 진단서 한 건 열기·지우기(#242, lib/contract-medical)
//  GET    — 본부·본인만. 원장·재무는 열 수 없다(표시만). 파일 형식은 앞 바이트로 다시 본다(HEIC 스위퍼가 JPEG 로 바꿔 둘 수 있다)
//  DELETE — 본부만. ATTACH_REMOVED 를 남기고 파일도 지운다(건강 정보 — 지운 것을 서버에 남겨 두지 않는다)
async function find(id: string, attId: string) {
  const c = await prisma.contract.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!c) return null;
  const att = (await medicalState(id)).attachments.find((a) => a.attId === attId);
  return att ? { c, att } : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id, attId } = await params;
  const hit = await find(id, attId);
  if (!hit) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });
  if (session.role !== "ADMIN" && hit.c.userId !== session.userId)
    return NextResponse.json({ error: "진단서는 본부와 본인만 볼 수 있습니다." }, { status: 403 });
  // key 는 저장할 때 서버가 만든 이름이지만, 경로 이탈은 한 번 더 막는다
  if (path.basename(hit.att.key) !== hit.att.key) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });
  const buf = await fs.readFile(path.join(medicalDir(id), hit.att.key)).catch(() => null);
  if (!buf) return NextResponse.json({ error: "파일이 서버에 없습니다. 본부에 알려 주세요." }, { status: 404 });
  const mime = sniffMime(new Uint8Array(buf.subarray(0, 16)), hit.att.mime);
  const name = /\.heic$|\.heif$/i.test(hit.att.name) && mime === "image/jpeg" ? hit.att.name.replace(/\.hei[cf]$/i, ".jpg") : hit.att.name;
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "진단서는 본부만 지울 수 있습니다." }, { status: 403 });
  const { id, attId } = await params;
  const hit = await find(id, attId);
  if (!hit) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });
  await removeMedicalFile({ contractId: id, att: hit.att, actorId: session.userId, actorName: session.name, request });
  return NextResponse.json({ ok: true });
}
