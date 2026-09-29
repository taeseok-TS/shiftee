import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listActiveEmoticonSets } from "@/lib/emoticons";

// 채팅 입력창의 이모티콘 고르는 창 — 켜진 세트의 켜진 항목만(2026-09-29)
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  return NextResponse.json({ sets: await listActiveEmoticonSets() });
}
