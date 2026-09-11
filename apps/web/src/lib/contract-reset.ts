import type { Prisma } from "@prisma/client";

/**
 * 계약 결재 **초기화의 단일 원천** (#206-1·#206-4, 2026-09-11 디렉터 결정).
 *
 * - 서명이 들어간 뒤 관리자가 내용을 **수정**하면 → 서명 전부 초기화, 1단계부터 다시(재발송과 같은 결과).
 *   종전에는 내용·파일이 바뀌어도 기존 서명이 그대로 남아 **새 내용 위에 옛 서명이 찍혔다**(이예지대리 #206-1).
 * - **반려**는 더 이상 최종이 아니다 → 관리자가 고쳐서 다시 보낼 수 있다(9/4 "반려=최종"을 디렉터가 바꿈).
 * - 어느 쪽이든 **옛 서명·반려 기록은 지우기 전에 이력(revocationLog)에 남긴다.** 재발송은 결재선을 지우고
 *   새로 만들어서 누가 언제 서명·반려했는지가 DB 에서 통째로 사라졌다(#206 조사).
 *
 * 이력에는 서명자·상태·시각만 남기고 **서명 이미지 주소는 넣지 않는다** — revocationLog 는 원장·직원 응답에도
 * 실려서, 남의 서명 PNG 주소가 위조 재료로 새 나간다(목록·결재함 API 가 이미 가리는 이유와 같다).
 */
type Tx = Prisma.TransactionClient;

export type ResetSigner = {
  order: number;
  approverId: string | null;
  name: string;
  status: string;
  decidedAt: string | null;
  comment: string | null;
  hadSignature: boolean;
};

async function decidedSnapshot(tx: Tx, contractId: string) {
  const line = await tx.contractApprovalLine.findUnique({
    where: { contractId },
    include: { steps: { orderBy: { order: "asc" }, include: { approver: { select: { name: true } } } } },
  });
  const steps = line?.steps ?? [];
  const signers: ResetSigner[] = steps
    .filter((s) => !!s.signatureUrl || s.status === "APPROVED" || s.status === "REJECTED")
    .map((s) => ({
      order: s.order,
      approverId: s.approverId,
      name: s.approver?.name ?? s.externalName ?? "외부 서명자",
      status: s.status,
      decidedAt: s.decidedAt ? s.decidedAt.toISOString() : null,
      comment: s.comment,
      hadSignature: !!s.signatureUrl,
    }));
  return { line, signers };
}

/** 이력 뒤에 한 줄 — 트랜잭션 **안에서** 다시 읽어 붙인다(동시에 일어난 회수·반려 기록을 덮어쓰지 않게, reject 라우트와 같은 방식). */
async function appendLog(tx: Tx, contractId: string, entry: Record<string, unknown>) {
  const fresh = await tx.contract.findUnique({ where: { id: contractId }, select: { revocationLog: true } });
  const logs = Array.isArray(fresh?.revocationLog) ? (fresh!.revocationLog as unknown[]) : [];
  await tx.contract.update({
    where: { id: contractId },
    data: { revocationLog: [...logs, entry] as Prisma.InputJsonValue },
  });
}

/**
 * 결재선을 **지우기 직전** 결정된 단계(서명·승인·반려)를 이력에 남긴다 — 재발송(단건 PATCH·패키지 발송)용.
 * 결정된 단계가 없으면 아무것도 남기지 않는다. 남긴 단계 수를 돌려준다.
 */
export async function preserveDecidedSteps(
  tx: Tx, contractId: string, kind: "resend" | "reset", by: string, reason: string
): Promise<number> {
  const { signers } = await decidedSnapshot(tx, contractId);
  if (signers.length === 0) return 0;
  await appendLog(tx, contractId, { type: kind, reason, revokedBy: by, revokedAt: new Date().toISOString(), signers });
  return signers.length;
}

/**
 * 결재선을 **그 자리에서** 처음으로 되돌린다 — 결재자 구성은 그대로 두고 모든 단계 WAITING, 1단계 PENDING,
 * 서명·결정·코멘트·리마인더 삭제. 외부 서명 단계는 **새 토큰**(옛 링크로 바뀐 내용에 서명하지 못하게, 14일).
 * 옛 서명·반려는 지우기 전에 이력으로 남긴다. 계약 쪽 상태(SENT·완료본·서명 시각)는 호출부가 같은 트랜잭션에서 바꾼다.
 * 서명·결정했던 사람들을 돌려준다(알림용).
 */
export async function resetApprovalInPlace(tx: Tx, contractId: string, by: string, reason: string): Promise<{ signers: ResetSigner[] }> {
  const { line, signers } = await decidedSnapshot(tx, contractId);
  if (!line || line.steps.length === 0) return { signers: [] };
  if (signers.length > 0) {
    await appendLog(tx, contractId, { type: "reset", reason, revokedBy: by, revokedAt: new Date().toISOString(), signers });
  }
  await tx.contractApprovalStep.updateMany({
    where: { approvalLineId: line.id },
    data: { status: "WAITING", decidedAt: null, comment: null, signatureUrl: null, remindedAt: null },
  });
  const expires = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  for (const s of line.steps) {
    if (!s.approverId && s.signToken) {
      await tx.contractApprovalStep.update({
        where: { id: s.id },
        data: { signToken: crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, ""), tokenExpiresAt: expires },
      });
    }
  }
  await tx.contractApprovalStep.update({ where: { id: line.steps[0].id }, data: { status: "PENDING" } });
  return { signers };
}
