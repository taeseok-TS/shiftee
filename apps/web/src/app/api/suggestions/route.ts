import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { botSendDM } from "@/lib/bot";

// 개선 제안함 — 작성자와 관리자만 열람 (비공개 창구)

// 목록: 관리자는 전체, 그 외에는 본인 것만
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const suggestions = await prisma.suggestion.findMany({
    where: session.role === "ADMIN" ? {} : { userId: session.userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ suggestions });
}

// 제안 등록 — 로그인한 직원 누구나
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const { title, content, imageUrls } = await request.json();
  if (!title?.trim() || !content?.trim())
    return NextResponse.json({ error: "제목과 내용을 입력해주세요." }, { status: 400 });

  // 첨부는 내부 업로드 경로만 허용
  const images: string[] =
    Array.isArray(imageUrls)
      ? (imageUrls as unknown[]).filter((u): u is string => typeof u === "string" && u.startsWith("/api/uploads/")).slice(0, 5)
      : [];

  // 작성 시점 이름·지점 스냅샷 (토큰 값은 오래됐을 수 있어 DB에서 조회)
  const me = await prisma.user.findUnique({ where: { id: session.userId }, select: { name: true, branch: true } });

  const suggestion = await prisma.suggestion.create({
    data: {
      userId: session.userId,
      userName: me?.name || session.name || "직원",
      userBranch: me?.branch ?? null,
      title: title.trim().slice(0, 100),
      content: content.trim().slice(0, 5000),
      imageUrls: images.length ? images : undefined,
    },
  });

  // 관리자에게 봇 DM으로 접수 알림 (응답을 막지 않게 비동기)
  (async () => {
    const admins = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true }, select: { id: true } });
    for (const a of admins) {
      await botSendDM(a.id, `💡 새 개선 제안이 접수되었습니다.\n"${suggestion.title}" — ${suggestion.userName}${suggestion.userBranch ? ` (${suggestion.userBranch})` : ""}\n관리자 화면 → 개선 제안에서 확인해주세요.`);
    }
  })().catch((e) => console.error("[suggestion] 관리자 알림 오류:", e));

  return NextResponse.json({ suggestion });
}
