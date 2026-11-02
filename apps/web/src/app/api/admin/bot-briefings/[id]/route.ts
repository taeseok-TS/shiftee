import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { runBriefing } from "@/lib/bot";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// 브리핑 수정 (관리자) — body에 sendNow:true면 즉시 발송 테스트
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  // 모든 관리자(2026-11-02 디렉터 회의 4번 — 설정 › 봇 브리핑). 봇 알림 담당자(notify-policy)는 그대로 최고 관리자
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const { id } = await params;
  const body = (await request.json()) as {
    name?: string; time?: string; enabled?: boolean; folder?: string | null;
    repeat?: string; repeatValue?: string | null;
    channelId?: string | null; branch?: string | null;
    showLeaves?: boolean; showEvents?: boolean; showAnniv?: boolean; showBirthday?: boolean;
    customText?: string | null;
    attachments?: { url: string; name: string; type: string }[];
    monthlyAttach?: boolean;
    sendNow?: boolean;
  };

  if (body.sendNow) {
    const result = await runBriefing(id, true);
    return NextResponse.json({ success: true, result });
  }

  if (body.time !== undefined && !TIME_RE.test(body.time))
    return NextResponse.json({ error: "시간은 HH:mm 형식이어야 합니다." }, { status: 400 });
  if (body.name !== undefined && !body.name.trim())
    return NextResponse.json({ error: "브리핑 이름을 입력해주세요." }, { status: 400 });

  if (body.repeat !== undefined && !["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(body.repeat))
    return NextResponse.json({ error: "반복 주기가 올바르지 않습니다." }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name.trim();
  if (body.folder !== undefined) data.folder = body.folder?.trim() || null;
  if (body.time !== undefined) data.time = body.time;
  if (body.enabled !== undefined) data.enabled = body.enabled;
  if (body.repeat !== undefined) data.repeat = body.repeat;
  if (body.repeatValue !== undefined) data.repeatValue = body.repeatValue || null;
  // 발송 채널은 화면 드롭다운과 같은 범위(공개 채널 · 숨김 아님)만 — 모든 관리자에게 열면서 막는다(2026-11-02 검증 9)
  if (body.channelId !== undefined) {
    if (body.channelId && !(await prisma.workChannel.findFirst({ where: { id: body.channelId, type: "CHANNEL", hidden: false, deletedAt: null }, select: { id: true } })))
      return NextResponse.json({ error: "발송 채널이 올바르지 않습니다." }, { status: 400 });
    data.channelId = body.channelId || null;
  }
  if (body.branch !== undefined) data.branch = body.branch || null;
  if (body.showLeaves !== undefined) data.showLeaves = body.showLeaves;
  if (body.showEvents !== undefined) data.showEvents = body.showEvents;
  if (body.showAnniv !== undefined) data.showAnniv = body.showAnniv;
  if (body.showBirthday !== undefined) data.showBirthday = body.showBirthday;
  if (body.customText !== undefined) data.customText = body.customText?.trim() || null;
  // 첨부는 큐브티에 올린 파일(/api/uploads/work/…)만 — 외부 주소를 봇 이름으로 올리지 못하게(2026-11-02 검증 9)
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments) || body.attachments.some((a) => !a || typeof a.url !== "string" || !a.url.startsWith("/api/uploads/work/")))
      return NextResponse.json({ error: "첨부 파일이 올바르지 않습니다." }, { status: 400 });
    data.attachments = body.attachments;
  }
  if (body.monthlyAttach !== undefined) data.monthlyAttach = body.monthlyAttach;
  if (Object.keys(data).length === 0)
    return NextResponse.json({ error: "변경할 내용이 없습니다." }, { status: 400 });

  const briefing = await prisma.botBriefing.update({ where: { id }, data });
  return NextResponse.json({ success: true, briefing });
}

// 브리핑 삭제 (관리자)
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  // 모든 관리자(2026-11-02 디렉터 회의 4번 — 설정 › 봇 브리핑). 봇 알림 담당자(notify-policy)는 그대로 최고 관리자
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const { id } = await params;
  await prisma.botBriefing.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
