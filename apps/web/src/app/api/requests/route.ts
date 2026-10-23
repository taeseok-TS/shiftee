import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { requestFeed } from "@/lib/request-feed";
import { canSeeClockTimes } from "@/lib/attendance-visibility";

export const dynamic = "force-dynamic";

// 요청 한눈에(2026-10-07 QA #51 #43 #76) — GET ?who=mine|decided&from&to&status&kind&q
// mine 은 누구나 자기 요청, decided 는 자기가 결재한 요청(결재한 적이 없으면 빈 목록)
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const sp = new URL(request.url).searchParams;
  const who = sp.get("who") === "decided" ? "decided" : "mine";
  const { items, limited } = await requestFeed(session.userId, who, {
    from: sp.get("from"), to: sp.get("to"), status: sp.get("status"), kind: sp.get("kind"), q: sp.get("q"),
    showTimes: await canSeeClockTimes(session.role),   // 출퇴근 요청의 올린 시각은 본부(와 「출퇴근 시각 보기」 켠 원장)만(10/23 검증 C)
  });
  return NextResponse.json({ items, limited });
}
