import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

// 휴지통: 삭제된(소프트) 채널 목록 (30일 보관). 관리자/원장은 전체, 그 외는 본인 생성 채널만.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const isAdmin = session.role === "ADMIN" || session.role === "MANAGER";
  const channels = await prisma.workChannel.findMany({
    where: {
      deletedAt: { not: null },
      type: "CHANNEL",
      // 대화가 한 건도 없는 회의 전용 방(숨김)은 되살릴 것이 없다 — 목록에 넣지 않는다(끝난 회의마다 하나씩 쌓인다, 2026-09-30)
      NOT: { hidden: true, messages: { none: {} } },
      // 회의 전용 방(숨김)은 본부 관리자와 만든 사람에게만 — 원장에게 남의 회의방 이름이 보이지 않게(검증관 C-2).
      // 위 createdBy 조건과 겹치지 않게 AND 로 건다.
      ...(session.role === "ADMIN" ? {} : { AND: [{ OR: [{ hidden: false }, { createdBy: session.userId }] }] }),
      ...(isAdmin ? {} : { createdBy: session.userId }),
    },
    select: { id: true, name: true, deletedAt: true, permanentlyDeletedAt: true, labelText: true, labelColor: true },
    orderBy: { deletedAt: "desc" },
  });

  return NextResponse.json({ channels });
}
