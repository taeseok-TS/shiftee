import { NextResponse } from "next/server";
import { getSession, issueSessionFor } from "@/lib/auth";

// 토큰 갱신 — 아직 유효한 토큰이면 새 7일 토큰 발급 (슬라이딩 세션).
// 앱이 실행/포그라운드 복귀할 때마다 호출하므로, 일주일에 한 번만 열어도 로그인이 유지된다.
export async function POST() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  // 최신 상태로 재발급 — 재직 검사(비활성.퇴사)와 DB 재조회는 issueSessionFor 안에 있다.
  // 검사를 여기 따로 베껴 쓰지 말 것. 그렇게 갈라지다 발급처마다 검사가 빠졌다.
  const token = await issueSessionFor(session.userId);
  if (!token) return NextResponse.json({ error: "사용할 수 없는 계정입니다." }, { status: 401 });

  return NextResponse.json({ success: true, token });
}
