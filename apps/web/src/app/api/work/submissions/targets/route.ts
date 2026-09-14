import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { targetUsersFor } from "@/lib/submission-targets";

export const dynamic = "force-dynamic";

// 제출 요청 「받는 사람」 고르기용 — 대상이 될 수 있는 사람 전원(본부·봇·퇴사자 제외). 본부만. 순수 GET.
// 100여 명이라 한 번에 내려 화면에서 검색·미리보기를 계산한다.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "본부 관리자만 볼 수 있습니다." }, { status: 403 });
  const users = await targetUsersFor({ targetJobGroups: [], targetBranches: [] });
  return NextResponse.json({ users });
}
