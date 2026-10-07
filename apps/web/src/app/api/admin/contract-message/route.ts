import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { readDefaultSendMessage, saveDefaultSendMessage, normalizeSendMessage, SEND_MESSAGE_MAX } from "@/lib/contract-send-meta";

export const dynamic = "force-dynamic";

// 전자계약 발송 기본 메시지(2026-10-07 QA #65) — 발송 창이 처음 열릴 때 채워진다. 관리자만.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  return NextResponse.json({ message: await readDefaultSendMessage(), max: SEND_MESSAGE_MAX });
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  const m = normalizeSendMessage(body?.message);
  if (m === "TOO_LONG") return NextResponse.json({ error: `메시지는 ${SEND_MESSAGE_MAX}자까지 쓸 수 있습니다.` }, { status: 400 });
  await saveDefaultSendMessage(m ?? "");
  await logAudit({
    actorId: session.userId, actorName: session.name, action: "CONTRACT_MESSAGE_UPDATE",
    targetType: "AppSetting", targetId: "contractSendMessage", detail: m ? m.slice(0, 120) : "(비움)",
  });
  return NextResponse.json({ success: true, message: m ?? "" });
}
