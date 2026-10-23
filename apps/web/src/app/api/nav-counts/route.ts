import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GET as leaveInbox } from "@/app/api/leave/my-approvals/route";
import { GET as scheduleInbox } from "@/app/api/schedule-requests/my-approvals/route";
import { GET as cancelInbox } from "@/app/api/leave/cancel-requests/my-approvals/route";
import { GET as attendanceRequests } from "@/app/api/attendance-requests/route";
import { GET as contractInbox } from "@/app/api/contracts/my-approvals/route";

export const dynamic = "force-dynamic";

// 왼쪽 메뉴의 빨간 불·건수(2026-10-20 본부 박정인 시안 v2 10번) — 「아직 안 끝난 건」만, 다 끝나면 0(불이 꺼진다).
// 「내 차례」 건수는 결재함 화면이 부르는 **같은 함수**를 그대로 불러 센다 — 결재함과 메뉴 숫자가 어긋나지 않게(규칙을 여기서 다시 쓰지 않는다).
//  approvals     = 결재함(휴가·근무일정·출퇴근 요청·휴가 취소 + 계약 결재) — 관리자·원장·원장대행
//  contractSign  = 계약 결재만(원장 「팀 계약서」)
//  leaveInbox    = 휴가·근무일정·출퇴근·취소 결재만(원장 「팀 휴가」, 원장대행 「결재」)
//  mySign        = 내가 서명할 계약서(직원 「내 계약서」)
//  contractsOpen = 보낸 계약서 중 서명이 안 끝난 것(관리자) · leavePending = 승인 대기 휴가(관리자) · templates = 양식 수(회색 숫자)
async function countOf(res: Response, key: string): Promise<number> {
  if (!res.ok) return 0;
  const d = await res.json().catch(() => null);
  const v = d?.[key];
  return Array.isArray(v) ? v.length : 0;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  const safe = (p: Promise<number>) => p.catch(() => 0);
  const inboxUrl = new URL("/api/attendance-requests?scope=inbox", request.url);

  const [leave, schedule, cancel, attendance, contract, mySign] = await Promise.all([
    // 결재함과 같은 함수에 이 요청을 넘긴다 — 메뉴 숫자는 includeTest 가 없어 테스트 계정 요청이 늘 빠진다(2026-10-23)
    safe(leaveInbox(request).then((r) => countOf(r, "steps"))),
    safe(scheduleInbox(request).then((r) => countOf(r, "steps"))),
    safe(cancelInbox(request).then((r) => countOf(r, "steps"))),
    safe(attendanceRequests(new NextRequest(inboxUrl, { headers: request.headers })).then((r) => countOf(r, "requests"))),
    safe(contractInbox(request).then((r) => countOf(r, "contracts"))),
    // 내 계약서 — 근로자 본인 서명 차례(서명 화면 「내 서명 대기」와 같은 조건)
    safe(prisma.contract.count({
      where: { userId: session.userId, externalName: null, status: { in: ["SENT", "APPROVED"] }, approvalLine: { steps: { some: { approverId: session.userId, status: "PENDING" } } } },
    })),
  ]);
  const leaveInboxN = leave + schedule + cancel + attendance;
  const out: Record<string, number> = { approvals: leaveInboxN + contract, leaveInbox: leaveInboxN, contractSign: contract, mySign };
  if (session.role === "ADMIN") {
    const [contractsOpen, leavePending, templates] = await Promise.all([
      safe(prisma.contract.count({ where: { status: { in: ["SENT", "APPROVED"] }, isTest: false } })),
      safe(prisma.leaveRequest.count({ where: { status: "PENDING", user: { deletedAt: null } } })),   // 휴가 관리 목록과 같은 조건(휴지통 계정 제외)
      safe(prisma.contractTemplate.count({ where: { isActive: true } })),
    ]);
    Object.assign(out, { contractsOpen, leavePending, templates });
  }
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
