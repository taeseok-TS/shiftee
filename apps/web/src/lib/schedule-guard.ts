// 근무일정 변경 권한 (2026-09-07 디렉터 지시 → 2026-10-07 본부 답변 #7·디렉터 결정으로 바뀜)
//
// 지금 규칙(10/7):
//  · 원장은 **본인 일정**과 **담당 지점의 다른 원장·직원 일정**을 직접 넣고 고친다(시프티와 같게).
//    원장이 넣은 주말 일정은 본부 승인 없이 바로 확정된다.
//  · 대신 원장 **본인 일정** 변경은 감사 로그에 남기고 본부에 진행 알림을 보낸다(noteManagerSelfChange).
//  · 하루 12시간 상한 등 시간 검증은 그대로(등록·수정 라우트).
//
// 종전 규칙(9/7, 참고):
//  · 원장(MANAGER)은 **자기 근무일정을 직접 만들거나 고칠 수 없다.** 신청을 올려
//    관리자 승인을 받아야 한다(그 경로는 이미 있다 — schedule-requests 가 원장 신청에
//    `approverRole: "ADMIN"` 결재선을 세운다).
//  · 원장은 **담당 지점 직원**의 일정만 다룬다. 종전에는 지점 검사가 아예 없어
//    평촌 원장이 id 만 알면 동탄 직원의 승인된 주말 일정을 지우거나 시간을 바꿀 수 있었다.
//
// 왜 중요한가: 주말.공휴일 출근은 승인된 근무일정이 있어야 가능하고, 퇴근 상한도
// 그 일정의 근무시간으로 계산된다. 즉 일정을 스스로 만들면 **출근 제한과 근무시간 상한을
// 동시에 무력화**할 수 있다(00:00~23:59 로 넣으면 상한이 24시간 44분이 된다).
import { prisma } from "@/lib/db";
import { getManagerBranches } from "@/lib/manager-branches";

type Session = { userId: string; role: string };

/** 허용이면 null, 막아야 하면 에러 메시지. */
export async function guardScheduleChange(
  session: Session,
  targetUserId: string,
  myBranches?: string[]
): Promise<string | null> {
  if (session.role === "ADMIN") return null;
  if (session.role !== "MANAGER") return "권한이 없습니다.";

  if (targetUserId === session.userId) return null;   // 본인 일정 — 허용하되 noteManagerSelfChange 로 남긴다

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { branch: true, role: true },
  });
  if (!target) return "직원을 찾을 수 없습니다.";
  // 같은 지점의 다른 원장도 고칠 수 있다(본부 답변 #7). 관리자 일정은 건드리지 않는다.
  if (target.role === "ADMIN") return "담당 지점 직원의 일정만 변경할 수 있습니다.";

  // 담당 지점은 부르는 쪽이 미리 읽어 넘길 수 있다 — 일괄 등록처럼 대상이 많을 때
  // 매번 다시 읽으면 대상 수만큼 쿼리가 늘어난다(200명 = 600쿼리, 2026-09-09 적발).
  const mine = myBranches ?? (await getManagerBranches(session.userId));
  if (!target.branch || !mine.includes(target.branch))
    return "담당 지점 직원의 일정만 변경할 수 있습니다.";
  return null;
}

/**
 * 원장이 **본인** 근무일정을 바꿨으면 감사 로그 + 본부 진행 알림(2026-10-07 디렉터 결정).
 * 주말 출근 제한·퇴근 상한이 일정에 걸려 있어, 스스로 바꾼 것은 본부가 알아야 한다.
 */
export async function noteManagerSelfChange(
  session: { userId: string; role: string; name: string },
  targetUserIds: string[],
  detail: string,
) {
  if (session.role !== "MANAGER" || !targetUserIds.includes(session.userId)) return;
  try {
    const { logAudit } = await import("@/lib/audit");
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "SCHEDULE_SELF_CHANGE",
      targetType: "USER", targetId: session.userId, targetName: session.name, detail: `원장 본인 근무일정 변경: ${detail}`,
    });
    const { botNotifyAdminsProgress } = await import("@/lib/bot");
    await botNotifyAdminsProgress(`${session.name} 원장 · 본인 근무일정 변경 — ${detail}`);
  } catch (e) {
    console.error("[schedule] 원장 본인 일정 변경 기록 실패:", e);
  }
}
