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
export async function logAudit(input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        actorName: input.actorName,
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
