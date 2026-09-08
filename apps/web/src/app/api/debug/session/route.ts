import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  try {
    // 모든 쿠키 로깅
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    // ⚠ 쿠키.토큰 값을 로그에 남기지 않는다 — 서버 로그를 보는 사람이 남의 세션을 그대로 쓸 수 있다.
    console.log("[DEBUG SESSION] 쿠키 이름:", allCookies.map((c) => c.name));

    const token = cookieStore.get("token")?.value;

    console.log("[DEBUG SESSION] Token cookie exists:", !!token);

    const session = await getSession();
    console.log("[DEBUG SESSION] Session result:", {
      hasSession: !!session,
      userId: session?.userId,
      role: session?.role,
      name: session?.name,
    });

    return NextResponse.json(
      {
        tokenExists: !!token,
        hasSession: !!session,
        session: session || null,
        allCookies: allCookies.map(c => c.name),
      },
      {
        headers: {
          "Cache-Control": "no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (error) {
    console.error("[DEBUG SESSION] Error:", error);
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
