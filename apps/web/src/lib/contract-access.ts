// 계약서 파일 접근 권한 — 한 곳에서만 판정한다 (2026-09-02)
//
// 왜 모았나: 계약서 파일이 나가는 문이 다섯 개(uploads 직접·docs/pdf 변환·원본 다운로드·
// 패키지 미리보기·완료본)인데 라우트마다 판정이 제각각이었다. 그래서 화면에서 버튼을 감춰도
// 다른 문으로 그대로 받아졌다 — 직원이 자기 화면의 파일 주소만으로 열람 금지 문서(사직원)를
// 네 가지 방법으로 우회할 수 있었다(독립 검증 2026-09-02).
//
// 정책 (이예지대리 요청 2026-09-02, ContractTemplate.postSignAccess)
//   none : 열람·다운로드 불가 — 근로자 화면엔 "제출 완료"만
//   view : 열람만 (다운로드 금지)
//   full : 열람·다운로드
// 서명이 끝난 문서(SIGNED)에만 적용한다. 진행 중에는 본인이 무엇에 서명하는지 봐야 하므로 연다.
import { prisma } from "@/lib/db";

export type AccessPrincipal = {
  userId: string | null;
  role: string | null; // ADMIN | MANAGER | EMPLOYEE | null(게스트·티켓만)
};

export type ContractAccess = {
  allowed: boolean;
  viewOnly: boolean;   // 열람만 허용 — 다운로드(첨부)로 내려주면 안 된다
  status: number;      // 거부 시 응답 코드
  error: string;       // 거부 시 메시지
};

const OK = (viewOnly = false): ContractAccess => ({ allowed: true, viewOnly, status: 200, error: "" });

const DENY_NONE: ContractAccess = {
  allowed: false, viewOnly: false, status: 403,
  error: "이 문서는 제출 완료 상태로, 사본이 필요하면 관리자에게 요청해주세요.",
};
const DENY_OTHER: ContractAccess = { allowed: false, viewOnly: false, status: 403, error: "접근 권한이 없습니다." };

type Row = {
  id: string;
  userId: string;
  status: string;
  branch: string | null;
  access: string | null;
  approverIds: string[] | null;
};

/** 파일명(또는 계약 id)이 어느 계약의 것인지 찾는다. 파일명은 여러 계약에 걸릴 수 있어 전부 본다. */
async function findContracts(target: { fileName?: string; contractId?: string }): Promise<Row[]> {
  if (target.contractId) {
    return prisma.$queryRaw<Row[]>`
      SELECT c.id, c."userId", c.status::text AS status, u."branch",
             t."postSignAccess" AS access,
             array_remove(array_agg(s."approverId"), NULL) AS "approverIds"
      FROM "Contract" c
      LEFT JOIN "User" u ON u.id = c."userId"
      LEFT JOIN "ContractTemplate" t ON t.id = c."templateId"
      LEFT JOIN "ContractApprovalLine" l ON l."contractId" = c.id
      LEFT JOIN "ContractApprovalStep" s ON s."approvalLineId" = l.id
      WHERE c.id = ${target.contractId}
      GROUP BY c.id, c."userId", c.status, u."branch", t."postSignAccess"`;
  }
  const name = (target.fileName || "").trim();
  if (!name) return [];
  // 정확 매칭 — 예전엔 LIKE '%파일명%' 이라 다른 계약에 걸릴 수 있었다.
  const url = `/api/uploads/contracts/${name}`;
  return prisma.$queryRaw<Row[]>`
    SELECT c.id, c."userId", c.status::text AS status, u."branch",
           t."postSignAccess" AS access,
           array_remove(array_agg(s."approverId"), NULL) AS "approverIds"
    FROM "Contract" c
    LEFT JOIN "User" u ON u.id = c."userId"
    LEFT JOIN "ContractTemplate" t ON t.id = c."templateId"
    LEFT JOIN "ContractApprovalLine" l ON l."contractId" = c.id
    LEFT JOIN "ContractApprovalStep" s ON s."approvalLineId" = l.id
    WHERE c."fileUrl"::jsonb ? ${url} OR c."signedUrl" = ${url}
    GROUP BY c.id, c."userId", c.status, u."branch", t."postSignAccess"`;
}

/** 계약 한 건에 대한 판정 */
async function judgeOne(row: Row, who: AccessPrincipal): Promise<ContractAccess> {
  if (who.role === "ADMIN") return OK();
  if (!who.userId) return DENY_OTHER; // 게스트·티켓 단독은 이 함수를 부르는 쪽에서 따로 처리

  const isOwner = row.userId === who.userId;
  if (isOwner) {
    // ⚠ 근로자는 자기 "서명" 단계 때문에 결재 스텝에도 들어간다. 결재자로 쳐서 정책을 건너뛰면
    //   사직원(none)이 본인에게 그대로 열린다. 그래서 당사자 판정을 먼저 본다.
    if (row.status !== "SIGNED") return OK(); // 서명 전 본인 확인
    const access = row.access || "full";
    if (access === "none") return DENY_NONE;
    return OK(access === "view");
  }

  // 결재자(당사자 제외) — 결재하려면 봐야 한다
  if ((row.approverIds || []).some((a) => a && a !== row.userId && a === who.userId))
    return OK();

  // 담당 지점 원장
  if (who.role === "MANAGER" && row.branch) {
    const { getManagerBranches } = await import("@/lib/manager-branches");
    if ((await getManagerBranches(who.userId)).includes(row.branch))
      return OK();
  }
  return DENY_OTHER;
}

/**
 * 계약서 파일을 이 사람이 볼 수 있는가.
 * 파일이 여러 계약에 걸리면 **가장 제한적인 판정**을 따른다(하나라도 막히면 막는다).
 */
export async function canAccessContractFile(
  target: { fileName?: string; contractId?: string },
  who: AccessPrincipal
): Promise<ContractAccess> {
  if (who.role === "ADMIN") return OK();

  const rows = await findContracts(target);
  if (rows.length === 0)
    return { allowed: false, viewOnly: false, status: 404, error: "문서를 찾을 수 없습니다." };

  let best: ContractAccess = DENY_OTHER;
  for (const row of rows) {
    const r = await judgeOne(row, who);
    if (!r.allowed) return r;            // 하나라도 막히면 막는다
    best = best.allowed ? OK(best.viewOnly || r.viewOnly) : r;
  }
  return best;
}
