import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { collectStorageStats, cleanupChannelAttachments, runHealthCheck } from "@/lib/monitor";

// 저장공간 현황 (관리자) — 디스크 + 채팅방별 첨부 용량 + 영상 압축 이력
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const [stats, issues, compressJobs] = await Promise.all([
    collectStorageStats(),
    // ⚠ heal 을 켜지 않는다 — 이 GET 이 상태를 바꾸면 Caddy 의 배포 중 GET 재시도로
    //   문서 재생성이 조용히 두 번 돈다(2026-09-04 검증관 B F5). 자가복구는 봇 점검에서만.
    runHealthCheck().then((a) => a.map((x) => x.text)),
    prisma.videoCompressJob.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);
  return NextResponse.json({ ...stats, issues, compressJobs });
}

// 채팅방 오래된 첨부 정리 (관리자) — { channelId, olderThanDays }
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 403 });

  const { channelId, olderThanDays } = (await request.json()) as { channelId?: string; olderThanDays?: number };
  if (!channelId) return NextResponse.json({ error: "채널을 선택해주세요." }, { status: 400 });
  const days = Number(olderThanDays);
  if (!Number.isInteger(days) || days < 30)
    return NextResponse.json({ error: "보관 기간은 최소 30일 이상이어야 합니다." }, { status: 400 });

  const result = await cleanupChannelAttachments(channelId, days);
  return NextResponse.json({ success: true, ...result });
}
