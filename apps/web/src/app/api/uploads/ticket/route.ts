import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { issueUploadTicket } from "@/lib/upload-ticket";

// 로그인한 사용자에게 업로드 파일 접근 티켓 발급 (12시간).
// 앱은 실행·로그인 시 받아 이미지·문서 URL 에 ?t= 로 부착한다.
// 티켓에 받는 사람 id 를 새겨, 받는 쪽에서 그 사람 권한으로 다시 판정한다 (2026-09-02).
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  return NextResponse.json({ t: issueUploadTicket(`u:${session.userId}`) });
}
