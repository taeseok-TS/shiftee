import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  try {
    // 모든 쿠키 로깅
    const cookieStore = await cookies();
    const allCookies = cookieStore.getAll();
    console.log("[DEBUG SESSION] All cookies:", allCookies.map(c => ({ name: c.name, value: c.value.substring(0, 30) })));

    const token = cookieStore.get("token")?.value;

    console.log("[DEBUG SESSION] Token cookie exists:", !!token);
    if (token) {
      console.log("[DEBUG SESSION] Token value (first 50 chars):", token.substring(0, 50));
    }

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
