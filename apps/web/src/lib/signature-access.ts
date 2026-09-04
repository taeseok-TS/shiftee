// 서명 이미지 파일 접근 판정 (2026-09-04, 검증관 B 지적)
//
// 종전에는 /api/uploads/signatures/* 가 **로그인 여부만** 봤다. 계약서 파일(contracts)에는
// "이 사람이 이 계약을 볼 수 있는가"를 묻는 판정이 붙어 있는데, 정작 **서명 이미지 자체**는
// URL 만 알면 아무 직원이나 받을 수 있었다. 파일명이 시각+난수라 열거는 어렵지만,
// 유출 경로가 하나만 더 생기면 바로 열린다 — 계약서와 같은 기준으로 막는다.
//
// 서명 이미지가 붙는 곳은 둘뿐이다:
//  ① ContractApprovalStep.signatureUrl — 그 계약을 볼 수 있는 사람만
//  ② User.signatureUrl (등록해 둔 도장/사인) — 본인과 관리자만
import { prisma } from "@/lib/db";
import type { AccessPrincipal, ContractAccess } from "@/lib/contract-access";

const OK: ContractAccess = { allowed: true, viewOnly: false, status: 200, error: "" };
const DENY: ContractAccess = { allowed: false, viewOnly: false, status: 403, error: "볼 수 없는 파일입니다." };

export async function canAccessSignatureFile(
  fileName: string,
  who: AccessPrincipal,
  guestContractId: string | null
): Promise<ContractAccess> {
  if (!fileName) return DENY;
  if (who.role === "ADMIN") return OK;
  const url = `/api/uploads/signatures/${fileName}`;

  // ⚠ 규칙마다 따로 막지 말고 **하나라도 통과하면 허용**한다. 같은 파일이 사용자의 등록
  //   서명이면서 결재 단계에도 걸려 있을 수 있는데, 먼저 검사한 규칙에서 막아 버리면
  //   자기 서명을 자기가 못 보는 상태가 된다 — 9/2 에 앱 첨부가 전부 401 이 됐던 것과
  //   같은 종류의 사고다(먼저 걸린 규칙 하나로 전체를 판정).
  if (who.userId) {
    const mine = await prisma.user.findFirst({
      where: { id: who.userId, signatureUrl: url }, select: { id: true },
    });
    if (mine) return OK; // 내가 등록해 둔 서명
  }

  const step = await prisma.contractApprovalStep.findFirst({
    where: { signatureUrl: url },
    select: { approverId: true, approvalLine: { select: { contractId: true } } },
  });
  if (!step) return DENY; // 어디에도 안 걸린 파일 — 통과시키면 "DB 에 없으면 누구나"가 된다
  if (who.userId && step.approverId === who.userId) return OK; // 내가 그린 서명

  const contractId = step.approvalLine?.contractId;
  if (!contractId) return DENY;
  // 게스트(외부 계약자)는 자기 계약의 서명만
  if (guestContractId) return guestContractId === contractId ? OK : DENY;
  // 그 밖에는 **계약서 파일과 같은 기준** — 계약을 볼 수 있으면 그 서명도 볼 수 있다.
  // (완료본 문서 안에 어차피 그려져 있으므로 문서 판정과 같아야 앞뒤가 맞는다)
  const { canAccessContractFile } = await import("@/lib/contract-access");
  const r = await canAccessContractFile({ contractId }, who);
  return r.allowed ? OK : DENY;
}
