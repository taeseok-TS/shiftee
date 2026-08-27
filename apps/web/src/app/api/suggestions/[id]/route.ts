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

// 같은 작성자에게 가는 상태 알림이 45초 안에 여러 건이면 한 건으로 묶어 발송 (#108)
// 모듈 스코프 버퍼 — 서버 재시작 시 유실은 허용(디렉터 확정)
const BATCH_WINDOW_MS = 45 * 1000;
const noticeBuffer = new Map<string, { timer: ReturnType<typeof setTimeout>; items: { seqNo: number; message: string }[] }>();

function queueSuggestionNotice(userId: string, seqNo: number, message: string) {
  const entry = noticeBuffer.get(userId);
  if (entry) {
    entry.items.push({ seqNo, message });
    return;
  }
  const timer = setTimeout(() => {
    const e = noticeBuffer.get(userId);
    noticeBuffer.delete(userId);
    if (!e || !e.items.length) return;
    const text = e.items.length === 1
      ? e.items[0].message // 1건이면 기존 형식 그대로
      : `✅ ${e.items.length}건 처리 — ${e.items.map((i) => `#${i.seqNo}`).join(", ")}\n(각 답변은 [개선 제안]에서 확인)`;
    botSendDM(userId, text).catch((err) => console.error("[suggestion] 작성자 알림 오류:", err));
  }, BATCH_WINDOW_MS);
  noticeBuffer.set(userId, { timer, items: [{ seqNo, message }] });
}

// 본인 제안 수정 — 아직 검토 전(접수 상태)일 때만 (디렉터 지시 2026-08-24)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { id } = await params;
  const { title, content, imageUrls } = await request.json();
  if (!title?.trim() || !content?.trim())
    return NextResponse.json({ error: "제목과 내용을 입력해주세요." }, { status: 400 });

  // 이미지 첨부 — 등록(POST)과 동일 검증: 내부 업로드 경로만, 최대 5장. 전체 교체 방식 (#138)
  const images: string[] | undefined = Array.isArray(imageUrls)
    ? (imageUrls as unknown[]).filter((u): u is string => typeof u === "string" && u.startsWith("/api/uploads/")).slice(0, 5)
    : undefined;

  const before = await prisma.suggestion.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "제안을 찾을 수 없습니다." }, { status: 404 });
  if (before.userId !== session.userId)
    return NextResponse.json({ error: "본인이 작성한 제안만 수정할 수 있습니다." }, { status: 403 });
  if (before.status !== "RECEIVED") {
    // 글 수정은 접수 상태에서만. 단, 이미지'만' 추가/교체하는 경우는 검토중·반영예정에서도 허용 —
    // 담당자가 추가 캡처를 요청하는 경우 대응 (#138)
    const textUnchanged = title.trim() === before.title && content.trim() === before.content;
    const imagesOnly = textUnchanged && images !== undefined;
    if (!(imagesOnly && (before.status === "REVIEWING" || before.status === "PLANNED")))
      return NextResponse.json({ error: "검토가 시작된 제안은 수정할 수 없습니다." }, { status: 400 });
  }

  const suggestion = await prisma.suggestion.update({
    where: { id },
    data: {
      title: title.trim().slice(0, 100),
      content: content.trim().slice(0, 5000),
      ...(images !== undefined ? { imageUrls: images } : {}),
    },
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
    // 접수/완료 알림이 한눈에 구분되게 — 상태별 이모지 + 상태를 첫 줄에 (#108, 2026-08-27)
    const EMOJI: Record<string, string> = { DONE: "✅", REVIEWING: "🔎", PLANNED: "🔧", HOLD: "⏸", RECEIVED: "📥" };
    const lines = [`${EMOJI[suggestion.status] || "💡"} [${STATUS_LABEL[suggestion.status] || suggestion.status}] #${suggestion.seqNo} ${suggestion.title}`];
    if (statusChanged) lines.push(`상태: ${STATUS_LABEL[before.status] || before.status} → ${STATUS_LABEL[suggestion.status]}`);
    if (commentAdded && suggestion.adminComment) lines.push(`답변: ${suggestion.adminComment}`);
    // 즉시 발송 대신 45초 버퍼 — 연속 처리 시 묶음 1건으로 (#108)
    queueSuggestionNotice(suggestion.userId, suggestion.seqNo, lines.join("\n"));
  }

  return NextResponse.json({ suggestion });
}
