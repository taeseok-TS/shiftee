import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// 직원 선택 삭제 (관리자 전용) — 잘못 업로드한 직원을 즉시 완전 삭제해 재업로드 가능하게 함.
// 활동 기록(출퇴근·휴가·메시지 등)이 있는 직원은 데이터 보호를 위해 삭제하지 않고 실패로 안내
// (그런 직원은 퇴사 처리 흐름을 사용). 부속 데이터(연차 잔여·기기·푸시토큰·채널 멤버십·겸직)는 함께 정리.
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN")
    return NextResponse.json({ error: "관리자만 직원을 삭제할 수 있습니다." }, { status: 403 });

  const { ids } = (await request.json().catch(() => ({}))) as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((v) => typeof v === "string"))
    return NextResponse.json({ error: "삭제할 직원을 선택해주세요." }, { status: 400 });

  let deleted = 0;
  let failed = 0;
  const errors: string[] = [];
  const deletedNames: string[] = [];

  for (const id of ids as string[]) {
    const user = await prisma.user.findUnique({ where: { id }, select: { name: true, role: true } });
    if (!user) { failed++; errors.push("직원을 찾을 수 없습니다."); continue; }
    if (user.role === "ADMIN" || id === session.userId) {
      failed++;
      errors.push(`${user.name}: 관리자 계정은 여기서 삭제할 수 없습니다.`);
      continue;
    }
    try {
      // 부속 데이터 정리 후 본체 삭제 — 활동 기록 FK가 남아 있으면 트랜잭션 전체가 실패(안전)
      await prisma.$transaction([
        prisma.leaveBalance.deleteMany({ where: { userId: id } }),
        prisma.managerBranch.deleteMany({ where: { userId: id } }),
        prisma.userDevice.deleteMany({ where: { userId: id } }),
        prisma.pushToken.deleteMany({ where: { userId: id } }),
        prisma.workChannelMember.deleteMany({ where: { userId: id } }),
        prisma.approvalLineStep.deleteMany({ where: { approvalLine: { userId: id } } }),
        prisma.approvalLine.deleteMany({ where: { userId: id } }),
        prisma.user.delete({ where: { id } }),
      ]);
      deleted++;
      deletedNames.push(user.name);
    } catch {
      failed++;
      errors.push(`${user.name}: 활동 기록(출퇴근·휴가·메시지 등)이 있어 삭제할 수 없습니다. 퇴사 처리를 사용해주세요.`);
    }
  }

  if (deleted > 0) {
    await logAudit({
      actorId: session.userId,
      actorName: session.name,
      action: "EMPLOYEE_BULK_DELETE",
      targetType: "USER",
      detail: `직원 ${deleted}명 선택 삭제 (${deletedNames.slice(0, 10).join(", ")}${deletedNames.length > 10 ? " 외" : ""})`,
    });
  }

  return NextResponse.json({ success: true, deleted, failed, errors: errors.slice(0, 10) });
}
