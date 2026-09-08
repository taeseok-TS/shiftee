import { prisma } from "@/lib/db";

type AuditInput = {
  actorId: string;
  actorName: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  targetName?: string | null;
  detail?: string | null;
};

// 관리자 변경 이력 기록. 실패해도 본 작업을 막지 않도록 try/catch.
//
// actorName 은 부르는 쪽이 **토큰에 박힌 이름**을 넘긴다. 토큰은 최대 7일 살아 있으므로
// 그 사이 개명하면 옛 이름이 기록에 남는다. 기록은 나중에 "누가 했나"를 따지는 근거이니
// DB 의 현재 이름을 우선한다. 조회 실패는 넘어온 이름으로 그대로 남긴다.
export async function logAudit(input: AuditInput) {
  try {
    let actorName = input.actorName;
    try {
      const u = await prisma.user.findUnique({ where: { id: input.actorId }, select: { name: true } });
      if (u?.name) actorName = u.name;
    } catch { /* 이름 조회 실패가 기록 자체를 막으면 안 된다 */ }

    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        actorName,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        targetName: input.targetName ?? null,
        detail: input.detail ?? null,
      },
    });
  } catch (e) {
    console.error("logAudit failed:", e);
  }
}
