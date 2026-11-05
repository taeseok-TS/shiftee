import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAppUrl } from "@/lib/app-url";
import { issueAttachTicket } from "@/lib/upload-ticket";
import { medicalState, medicalViewer } from "@/lib/contract-medical";

// 진단서 열람 링크 발급(#242, 2026-11-05 디렉터 「앱에서도 진단서 열리게」) — signed-link 와 같은 방식.
// 앱은 외부 브라우저로 여는데 브라우저에는 세션이 없다 → 여기서 세션으로 본부·본인·재무를 확인하고, 이 첨부 1개에만 통하는 3분 티켓 주소를 준다.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string; attId: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const { id, attId } = await params;
  const c = await prisma.contract.findUnique({ where: { id }, select: { userId: true, status: true, isTest: true } });
  if (!c) return NextResponse.json({ error: "계약서를 찾을 수 없습니다." }, { status: 404 });
  if (!(await medicalViewer(session, c))) return NextResponse.json({ error: "진단서는 본부·본인·재무팀만 볼 수 있습니다." }, { status: 403 });
  if (!(await medicalState(id)).attachments.some((a) => a.attId === attId)) return NextResponse.json({ error: "첨부를 찾을 수 없습니다." }, { status: 404 });
  return NextResponse.json(
    { url: `${getAppUrl()}/api/contracts/${id}/attachments/${encodeURIComponent(attId)}?at=${issueAttachTicket(id, attId)}` },
    { headers: { "Cache-Control": "no-store, private" } },
  );
}
