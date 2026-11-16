import { NextRequest } from "next/server";
import { handleLeaveDecisionApi } from "@/lib/leave-decision-api";

export const dynamic = "force-dynamic";

// 휴가 신청 반려 — 회사 연동 키(ORG, scope leave:approve) 전용. 규칙 · 응답은 lib/leave-decision-api.ts (2026-11-16 이예지 요청)
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleLeaveDecisionApi(request, id, "reject");
}
