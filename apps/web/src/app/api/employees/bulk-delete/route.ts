import { NextRequest, NextResponse } from "next/server";
import { getSession, clearSessionCache } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";

// 직원 선택 삭제 (관리자 전용) — 잘못 업로드한 직원을 즉시 완전 삭제해 재업로드 가능하게 함.
// 활동 기록(출퇴근·휴가·메시지 등)이 있는 직원은 데이터 보호를 위해 삭제하지 않고 실패로 안내
// (그런 직원은 퇴사 처리 흐름을 사용). 부속 데이터(연차 잔여·기기·푸시토큰·채널 멤버십·겸직)는 함께 정리.
// 잘못 올린 직원을 지울 수 있는 기간 — 등록 후 7일
const BULK_DELETE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
    const user = await prisma.user.findUnique({ where: { id }, select: { name: true, role: true, createdAt: true } });
    if (!user) { failed++; errors.push("직원을 찾을 수 없습니다."); continue; }
    if (user.role === "ADMIN" || id === session.userId) {
      failed++;
      errors.push(`${user.name}: 관리자 계정은 여기서 삭제할 수 없습니다.`);
      continue;
    }
    // ⚠ **등록한 지 7일이 지난 직원은 지우지 않는다** — 이 버튼은 잘못 올린 직원을 올린 직후에 지우는 용도다.
    //   "활동 기록이 있으면 거부"를 종류별로 막는 방식은 계속 새 구멍이 나왔다(메신저 연쇄 삭제, 휴가·일정 결재자
    //   칸이 비워짐, 지점 대표 원장 연결 끊김, 제출물·제안·투표·회의 기록이 없는 직원을 가리킴 — 2026-09-18 검증관).
    //   기간 하나로 거는 편이 빠진 종류가 있어도 막힌다. 그 뒤의 정리는 퇴사일(또는 휴지통 삭제)로 한다.
    if (Date.now() - user.createdAt.getTime() > BULK_DELETE_WINDOW_MS) {
      failed++;
      errors.push(`${user.name}: 등록한 지 7일이 지난 직원은 여기서 삭제할 수 없습니다. 퇴사는 직원 정보에서 퇴사일을 넣어 처리해주세요.`);
      continue;
    }
    if (await prisma.userDevice.count({ where: { userId: id } })) {
      failed++; // 앱에 로그인한 적이 있으면 잘못 올린 직원이 아니다
      errors.push(`${user.name}: 앱에 로그인한 기록이 있어 삭제할 수 없습니다. 퇴사일로 처리해주세요.`);
      continue;
    }
    // ⚠ 메신저 기록(메시지·반응·북마크·리마인더·예약 메시지)은 스키마가 **연쇄 삭제(Cascade)** 라 아래 FK 실패에
    //   걸리지 않고 조용히 함께 지워진다. 그래서 "활동 기록이 있으면 거부"가 메신저만 쓴 직원에게는 통하지 않았다 —
    //   2026-09-18 퇴사 처리해야 할 직원(입사 3년 차)이 이 경로로 지워져 메시지 13건과 반응이 함께 사라졌다(백업에서 복원).
    //   메신저 기록이 하나라도 있으면 "잘못 올린 직원"이 아니라 실제 직원이므로 삭제하지 않는다.
    const [msgs, reacts, marks, rems, sched] = await Promise.all([
      prisma.workMessage.count({ where: { userId: id } }),
      prisma.workMessageReaction.count({ where: { userId: id } }),
      prisma.workBookmark.count({ where: { userId: id } }),
      prisma.workReminder.count({ where: { userId: id } }),
      prisma.workScheduledMessage.count({ where: { userId: id } }),
    ]);
    if (msgs + reacts + marks + rems + sched > 0) {
      failed++;
      errors.push(`${user.name}: 메신저 기록이 있어 삭제할 수 없습니다. 퇴사는 직원 정보에서 퇴사일을 넣어 처리해주세요.`);
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
      // 행이 사라져도 세션 캐시에는 30초간 남는다 — 지운 사람의 토큰이 그 사이 통과한다.
      // 하드 삭제는 update 가 아니므로 bumpTokenVersion 을 쓸 수 없다(2026-09-08 적발).
      clearSessionCache(id);
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
