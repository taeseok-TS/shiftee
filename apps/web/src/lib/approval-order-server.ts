import { prisma } from "@/lib/db";
import { parseApprovalSteps, checkOrder, type ApproverRole } from "@/lib/approval-order";

// 발송 시 결재 순서 검사(서버) — 양식의 결재 순서가 고정(approvalLocked)이면 보낸 결재자 목록이 그 순서와 같아야 한다.
// 단건 발송(contracts/[id] PATCH)과 패키지 발송(bundle/[bundleId]/send)이 같은 함수를 쓴다. 양식이 없거나 순서가 없으면 검사하지 않는다(종전과 같음)
export async function validateSendOrder(opts: {
  approverIds: string[];
  templateId: string | null | undefined;
  contractUserId: string;
  external: boolean;
}): Promise<string | null> {
  if (!opts.templateId) return null;
  const t = await prisma.contractTemplate.findUnique({ where: { id: opts.templateId }, select: { approvalSteps: true, approvalLocked: true, name: true } });
  if (!t || !t.approvalLocked) return null;
  const steps = parseApprovalSteps(t.approvalSteps);
  if (!steps) return null;
  const ids = opts.approverIds.filter((id) => id !== "EXTERNAL");
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set([...ids, opts.contractUserId])] } }, select: { id: true, role: true } });
  const roles = new Map(users.map((u) => [u.id, u.role as ApproverRole]));
  const r = checkOrder(opts.approverIds, steps, {
    contractUserId: opts.contractUserId, external: opts.external,
    partyIsManager: !opts.external && roles.get(opts.contractUserId) === "MANAGER",
  }, (id) => roles.get(id) ?? null);
  if (r.ok) return null;
  return `[${t.name}] ${r.error}`;
}
