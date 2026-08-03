import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getWorkUnreadTotal } from "@/lib/work-unread";

// 내 미확인(신규) 메시지 총 개수 — 앱 메신저 탭 배지용.
// 계산 규칙은 lib/work-unread.ts 공용 함수(푸시 badge와 동일 기준).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const total = await getWorkUnreadTotal(session.userId, session.name);
  return NextResponse.json({ total });
}
