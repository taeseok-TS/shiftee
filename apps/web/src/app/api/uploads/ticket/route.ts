import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { issueUploadTicket } from "@/lib/upload-ticket";
import { uploadGateGroups } from "@/lib/upload-gate";

// 로그인한 사용자에게 업로드 파일 접근 티켓 발급 (12시간).
// 티켓에 받는 사람 id 를 새겨, 받는 쪽에서 그 사람 권한으로 다시 판정한다 (2026-09-02).
//
// gate: 게이트가 켜진 경로군 목록. 앱은 **이 목록에 있는 경로에만** ?t= 를 붙인다 —
// 그래야 게이트 밖 파일(채팅 첨부 등)의 URL 이 고정돼 이미지 캐시가 유지되고,
// 나중에 서버에서 경로군을 늘려도 앱을 다시 배포하지 않아도 된다.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  return NextResponse.json({ t: issueUploadTicket(`u:${session.userId}`), gate: uploadGateGroups() });
}
