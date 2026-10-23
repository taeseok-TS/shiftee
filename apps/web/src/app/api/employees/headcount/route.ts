import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getManagerBranches } from "@/lib/manager-branches";
import { headcountSummary } from "@/lib/employee-scope";

// 인원 숫자(2026-10-23 본부 요청 ■0-9 · ■3) — 전체 직원(지점 재직 + 휴직) · 지점 직원 · 휴직 · 원장 · 지점별.
// 대시보드 · 인사 › 직원 · 인사 › 현황 · 원장 화면이 이 숫자 하나를 쓴다(기준은 lib/employee-scope 한 곳).
// 본부 = 전 지점, 원장 = 담당 지점(대표 + 겸직), 직원 = 없음
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN" && session.role !== "MANAGER") return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
  const branches = session.role === "MANAGER" ? await getManagerBranches(session.userId) : undefined;
  return NextResponse.json(await headcountSummary({ branches }));
}
