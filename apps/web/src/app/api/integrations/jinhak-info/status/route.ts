import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { jinhakInfoEnabled } from "@/lib/jinhak-info-pass";

// 입학정보실 단추를 보일지(웹 큐브티워크·앱 더보기) — 2026-10-19 디렉터 「잠깐 숨겨놔」.
// 서버 .env 의 INFO_PASS_ENABLED=1 과 열쇠가 있을 때만 true. 켜고 끌 때 다시 빌드·앱 업데이트가 필요 없게 화면이 이 값을 묻는다.
// 읽기만 하는 GET(무중단 프록시 재시도 안전), 값(열쇠)은 내보내지 않는다.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ enabled: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ enabled: jinhakInfoEnabled() }, { headers: { "Cache-Control": "no-store" } });
}
