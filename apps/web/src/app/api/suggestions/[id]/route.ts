import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { botSendDM } from "@/lib/bot";

const STATUS_LABEL: Record<string, string> = {
  RECEIVED: "접수",
  REVIEWING: "검토중",
  PLANNED: "반영 예정",
  DONE: "완료",
  HOLD: "보류",
};

// 본인 제안 수정 — 아직 검토 전(접수 상태)일 때만 (디렉터 지시 2026-08-24)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { title, content } = await request.json();
  if (!title?.trim() || !content?.trim())
    return NextResponse.json({ error: "제목과 내용을 입력해주세요." }, { status: 400 });

  const before = await prisma.suggestion.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "제안을 찾을 수 없습니다." }, { status: 404 });
  if (before.userId !== session.userId)
    return NextResponse.json({ error: "본인이 작성한 제안만 수정할 수 있습니다." }, { status: 403 });
  if (before.status !== "RECEIVED")
    return NextResponse.json({ error: "검토가 시작된 제안은 수정할 수 없습니다." }, { status: 400 });

  const suggestion = await prisma.suggestion.update({
    where: { id },
    data: { title: title.trim().slice(0, 100), content: content.trim().slice(0, 5000) },
  });
  return NextResponse.json({ suggestion });
}

// 상태·답변 변경 — 관리자 전용. 변경 시 작성자에게 봇 DM 통지
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });

  const { id } = await params;
  const { status, adminComment } = await request.json();
  if (status && !STATUS_LABEL[status])
    return NextResponse.json({ error: "잘못된 상태값입니다." }, { status: 400 });

  const before = await prisma.suggestion.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "제안을 찾을 수 없습니다." }, { status: 404 });

  const suggestion = await prisma.suggestion.update({
    where: { id },
    data: {
      ...(status ? { status } : {}),
      ...(adminComment !== undefined ? { adminComment: adminComment?.trim() || null } : {}),
    },
  });

  // 상태가 바뀌었거나 답변이 새로 달리면 작성자에게 통지 — "내 의견이 처리되고 있다"가 보여야 창구가 산다
  const statusChanged = status && status !== before.status;
  const commentAdded = adminComment !== undefined && (adminComment?.trim() || "") !== (before.adminComment || "");
  if (statusChanged || commentAdded) {
    const lines = [`💡 개선 제안 #${suggestion.seqNo} "${suggestion.title}" 처리 현황이 업데이트되었습니다.`];
    if (statusChanged) lines.push(`상태: ${STATUS_LABEL[before.status] || before.status} → ${STATUS_LABEL[suggestion.status]}`);
    if (commentAdded && suggestion.adminComment) lines.push(`답변: ${suggestion.adminComment}`);
    botSendDM(suggestion.userId, lines.join("\n")).catch((e) => console.error("[suggestion] 작성자 알림 오류:", e));
  }

  return NextResponse.json({ suggestion });
}
