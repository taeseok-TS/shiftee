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
  employeeSignedAt: Date | null;
  branch: string | null;
  access: string | null;
  hasTemplate: boolean;
  approverIds: string[] | null;
};

/** 파일명(또는 계약 id)이 어느 계약의 것인지 찾는다. 파일명은 여러 계약에 걸릴 수 있어 전부 본다. */
async function findContracts(target: { fileName?: string; contractId?: string }): Promise<Row[]> {
  if (target.contractId) {
    return prisma.$queryRaw<Row[]>`
      SELECT c.id, c."userId", c.status::text AS status, c."employeeSignedAt", u."branch",
             t."postSignAccess" AS access, (c."templateId" IS NOT NULL) AS "hasTemplate",
             array_remove(array_agg(s."approverId"), NULL) AS "approverIds"
      FROM "Contract" c
      LEFT JOIN "User" u ON u.id = c."userId"
      LEFT JOIN "ContractTemplate" t ON t.id = c."templateId"
      LEFT JOIN "ContractApprovalLine" l ON l."contractId" = c.id
      LEFT JOIN "ContractApprovalStep" s ON s."approvalLineId" = l.id
      WHERE c.id = ${target.contractId}
      GROUP BY c.id, c."userId", c.status, c."employeeSignedAt", u."branch", t."postSignAccess", c."templateId"`;
  }
  const name = (target.fileName || "").trim();
  if (!name) return [];
  // 정확 매칭 — 예전엔 LIKE '%파일명%' 이라 다른 계약에 걸릴 수 있었다.
  const url = `/api/uploads/contracts/${name}`;
  return prisma.$queryRaw<Row[]>`
    SELECT c.id, c."userId", c.status::text AS status, c."employeeSignedAt", u."branch",
           t."postSignAccess" AS access, (c."templateId" IS NOT NULL) AS "hasTemplate",
           array_remove(array_agg(s."approverId"), NULL) AS "approverIds"
    FROM "Contract" c
    LEFT JOIN "User" u ON u.id = c."userId"
    LEFT JOIN "ContractTemplate" t ON t.id = c."templateId"
    LEFT JOIN "ContractApprovalLine" l ON l."contractId" = c.id
    LEFT JOIN "ContractApprovalStep" s ON s."approvalLineId" = l.id
    WHERE (CASE WHEN left(btrim(c."fileUrl"), 1) = '[' THEN c."fileUrl"::jsonb ? ${url} ELSE c."fileUrl" = ${url} END)
       OR c."signedUrl" = ${url}
    GROUP BY c.id, c."userId", c.status, c."employeeSignedAt", u."branch", t."postSignAccess", c."templateId"`;
}

/** 계약 한 건에 대한 판정 */
async function judgeOne(row: Row, who: AccessPrincipal): Promise<ContractAccess> {
  if (who.role === "ADMIN") return OK();
  if (!who.userId) return DENY_OTHER; // 주체를 모르는 접근(티켓 무주체 등)은 막는다

  // 문서 정책. 템플릿 연결이 끊긴 계약은 "정책 없음"이지 "제한 없음"이 아니다 —
  // 템플릿을 지우면 templateId 가 NULL 이 되는데, 그때 full 로 풀리면 과거 계약이 전부 열린다.
  // 정해진 값이 아니면(오타·대소문자 등) 가장 엄격하게 본다 — 정책 필드는 fail-closed 여야 한다.
  // 정해진 값이 아니면(오타·대소문자 등) 가장 엄격하게 본다 — 정책 필드는 fail-closed 여야 한다.
  // 단 **템플릿 없이 파일만 올린 계약은 정상 운용**이므로 종전대로 제한 없음(full)이다.
  // ⚠ 이걸 view 로 잠갔더니 근로계약서 교부가 막혔다(업무 정지). 템플릿 삭제로 연결이 끊긴
  //   경우와 구분이 안 되는 것은 아는 한계 — 삭제 쪽은 템플릿을 지우지 않는 운영으로 막는다.
  const raw = row.hasTemplate ? row.access : "full";
  const access = raw === "full" || raw === "view" || raw === "none" ? raw : "none";

  const isOwner = row.userId === who.userId;
  if (isOwner) {
    // ⚠ 근로자는 자기 "서명" 단계 때문에 결재 스텝에도 잡힌다. 결재자로 쳐서 정책을 건너뛰면
    //   사직원(none)이 본인에게 그대로 열린다. 당사자 판정을 먼저 본다.
    //
    // 정책 적용 시점은 계약 status 가 아니라 **본인이 서명을 마쳤는가**로 본다.
    // status 로 보면 뒤에 결재가 남은 동안 APPROVED 에 머물러 그 구간이 통째로 열리고,
    // 서명 회수(SENT 로 되돌림)로 다시 열린다.
    if (!row.employeeSignedAt) return OK(); // 아직 서명 전 — 무엇에 서명하는지 봐야 한다
    if (access === "none") return DENY_NONE;
    return OK(access === "view");
  }

  // 결재자(당사자 제외) — 결재하려면 봐야 한다. 다만 **열람까지만**.
  // 완료본 라우트가 "원장 등 결재자는 서명본 보관 불가"로 막고 있어, 여기서 다운로드를
  // 열어주면 같은 문서가 문에 따라 달라진다.
  const isApprover = (row.approverIds || []).some((a) => a && a !== row.userId && a === who.userId);
  if (isApprover) {
    if (access === "none" && row.employeeSignedAt) return DENY_NONE;
    return OK(true);
  }

  // 담당 지점 원장 — 마찬가지로 열람까지만
  if (who.role === "MANAGER" && row.branch) {
    const { getManagerBranches } = await import("@/lib/manager-branches");
    if ((await getManagerBranches(who.userId)).includes(row.branch)) {
      if (access === "none" && row.employeeSignedAt) return DENY_NONE;
      return OK(true);
    }
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

  let rows: Row[];
  try {
    rows = await findContracts(target);
  } catch (e) {
    // 판정에 실패하면 연다가 아니라 막는다 (라우트가 catch 를 두더라도 fail-open 이 되지 않게)
    console.error("[contract-access] 권한 조회 실패:", e);
    return { allowed: false, viewOnly: false, status: 403, error: "접근 권한을 확인할 수 없습니다." };
  }
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

/**
 * 세션 또는 티켓 주체로 "누구인가"를 정한다.
 * 티켓은 발급 때 새긴 주체(u:userId / c:contractId)를 그대로 신뢰한다 — 서명돼 있어 위조 불가.
 */
export async function resolvePrincipal(
  session: { userId: string; role: string } | null,
  ticketSubject: string | null
): Promise<{ who: AccessPrincipal; guestContractId: string | null }> {
  if (session) return { who: { userId: session.userId, role: session.role }, guestContractId: null };
  if (ticketSubject?.startsWith("c:")) return { who: { userId: null, role: null }, guestContractId: ticketSubject.slice(2) };
  if (ticketSubject?.startsWith("u:")) {
    const uid = ticketSubject.slice(2);
    const u = await prisma.user.findUnique({ where: { id: uid }, select: { id: true, role: true, isActive: true } });
    if (u?.isActive) return { who: { userId: u.id, role: u.role }, guestContractId: null };
  }
  return { who: { userId: null, role: null }, guestContractId: null };
}

/**
 * 게스트 티켓(c:계약id)이 이 파일에 대해 유효한가.
 * 패키지(묶음) 서명은 한 링크에서 동반 문서(비밀유지·개인정보동의서 등)를 함께 넘기므로,
 * 같은 bundleId 의 형제 계약 파일도 인정해야 한다 — 아니면 2번째 탭부터 열리지 않아
 * 읽지도 못한 문서에 서명하게 된다.
 */
export async function guestTicketCovers(contractId: string, fileName: string): Promise<boolean> {
  const rows = await findContracts({ fileName });
  if (rows.length === 0) return false;
  if (rows.some((r) => r.id === contractId)) return true;
  const me = await prisma.contract.findUnique({ where: { id: contractId }, select: { bundleId: true } });
  if (!me?.bundleId) return false;
  const sibs = await prisma.contract.findMany({
    where: { bundleId: me.bundleId },
    select: { id: true },
  });
  const ids = new Set(sibs.map((s) => s.id));
  return rows.some((r) => ids.has(r.id));
}
