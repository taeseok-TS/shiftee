// 근무일정 변경 권한 (2026-09-07 디렉터 지시)
//
// 규칙:
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

  if (targetUserId === session.userId)
    return "본인 근무일정은 직접 등록할 수 없습니다. 근무일정을 신청하면 관리자 승인 후 반영됩니다.";

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    select: { branch: true, role: true },
  });
  if (!target) return "직원을 찾을 수 없습니다.";
  // 다른 원장의 일정도 건드리지 않는다 — 서로의 근무를 임의로 바꿀 수 있으면 안 된다.
  if (target.role !== "EMPLOYEE") return "담당 지점 직원의 일정만 변경할 수 있습니다.";

  // 담당 지점은 부르는 쪽이 미리 읽어 넘길 수 있다 — 일괄 등록처럼 대상이 많을 때
  // 매번 다시 읽으면 대상 수만큼 쿼리가 늘어난다(200명 = 600쿼리, 2026-09-09 적발).
  const mine = myBranches ?? (await getManagerBranches(session.userId));
  if (!target.branch || !mine.includes(target.branch))
    return "담당 지점 직원의 일정만 변경할 수 있습니다.";
  return null;
}
