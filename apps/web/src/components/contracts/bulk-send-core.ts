// 초안 여러 건 발송의 공통 규칙 — 「선택한 초안 한꺼번에 발송」 창(BulkSendDialog, 2026-10-07 QA #34)과
// 「계약서 보내기」 3단계(FlowSendStep, 2026-10-20 시안 v2)가 함께 쓴다. 결재선 규칙을 두 군데로 나누지 않는다.
//
// 결재선은 건마다 양식의 결재 순서대로(#213-2): 본부 = 고른 한 명(당사자 본인이면 비움), 원장 = 당사자 지점 원장(자동), 근로자 = 당사자.
// 패키지는 묶음 발송 한 번(결재 순서는 대표 문서 기준 — 서버 bundle/send 와 같은 기준), 직원전용 단독 문서는 직원 본인 한 단계.
// 외부 계약은 링크 전달이 따로라 빼고 알린다.
import { DEFAULT_STEPS, parseApprovalSteps, type ApprovalStepSpec } from "@/lib/approval-order";

export type SendContract = {
  id: string; userId: string; title: string; status: string; bundleId?: string | null; employeeOnly?: boolean;
  externalName?: string | null; user: { name: string; branch?: string | null };
  approvalSteps?: { kind: string }[] | null;   // 양식의 결재 순서(#213-2)
  templateId?: string | null; createdAt?: string;
};
export type SendEmployee = { id: string; name: string; role?: string; branch?: string | null; managerBranches?: string[]; isContractApprover?: boolean };
export type SendUnit = { key: string; c: SendContract; bundle: boolean };

/** 당사자 지점 원장 — 메인 원장 우선(단건 발송 창 partyBranchManagerId 와 같은 규칙, 2026-10-20 검증 F5), 없으면 그 지점 원장(겸직 포함).
 *  당사자 본인이면 없음(같은 사람이 두 번 결재하지 않게) */
export function mgrOf(c: SendContract, employees: SendEmployee[], mainManagerIds?: Record<string, string>): SendEmployee | undefined {
  const b = c.user.branch;
  const mainId = b ? mainManagerIds?.[b] : undefined;
  const m = (mainId ? employees.find((e) => e.id === mainId) : undefined)
    ?? (b ? employees.find((e) => e.role === "MANAGER" && (e.branch === b || (e.managerBranches || []).includes(b))) : undefined);
  return m && m.id !== c.userId ? m : undefined;
}

/** 보낼 단위 — 패키지는 하나로 묶는다(반려 문서는 그 문서만). 외부 계약은 뺀다 */
export function planUnits(contracts: SendContract[]): SendUnit[] {
  const seen = new Set<string>(); const out: SendUnit[] = [];
  for (const c of contracts) {
    if (c.externalName) continue;
    const bundle = !!c.bundleId && c.status !== "REJECTED";
    const key = bundle ? `b:${c.bundleId}` : c.id;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ key, c, bundle });
  }
  return out;
}

/** 패키지의 결재 순서는 **대표 문서**(직원전용이 아닌 가장 먼저 만들어진 문서)의 양식에서 읽는다(재검증 F8) */
export function repOf(u: SendUnit, contracts: SendContract[]): SendContract {
  return u.bundle
    ? ([...contracts].filter((c) => c.bundleId === u.c.bundleId && !c.employeeOnly && c.templateId).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""))[0] ?? u.c)
    : u.c;
}

export const specsOf = (c: SendContract): ApprovalStepSpec[] => parseApprovalSteps(c.approvalSteps) ?? DEFAULT_STEPS;
export const employeeOnlySingle = (u: SendUnit) => !!u.c.employeeOnly && !u.bundle;

/** 이 단위의 결재 순서(직원전용 단독 문서는 근로자 한 단계) */
export function unitSpecs(u: SendUnit, contracts: SendContract[]): ApprovalStepSpec[] {
  return employeeOnlySingle(u) ? [{ kind: "EMPLOYEE" } as ApprovalStepSpec] : specsOf(repOf(u, contracts));
}

/** 본부 단계가 둘 이상인 단위 — 한 명만 골라서는 못 보낸다(개별 발송) */
export const isMultiHq = (u: SendUnit, contracts: SendContract[]) => !employeeOnlySingle(u) && unitSpecs(u, contracts).filter((s) => s.kind === "HQ").length > 1;
/** 본부 단계가 있는 단위가 하나라도 있으면 본부를 골라야 한다 */
export const needsHq = (units: SendUnit[], contracts: SendContract[]) => units.some((u) => !employeeOnlySingle(u) && unitSpecs(u, contracts).some((s) => s.kind === "HQ"));

/** 결재자 id 순서 — 양식 순서대로, 본부는 고른 한 명(당사자 본인이면 비움 — #34 검증 F13), 원장은 자동, 근로자는 당사자 */
export function approverIdsOf(u: SendUnit, contracts: SendContract[], employees: SendEmployee[], hq: string, mainManagerIds?: Record<string, string>, specs?: ApprovalStepSpec[]): string[] {
  if (employeeOnlySingle(u)) return [u.c.userId];
  return (specs ?? unitSpecs(u, contracts))
    .map((s) => s.kind === "HQ" ? (hq !== u.c.userId ? hq : null) : s.kind === "MANAGER" ? (mgrOf(u.c, employees, mainManagerIds)?.id ?? null) : s.kind === "EMPLOYEE" ? u.c.userId : null)
    .filter((x): x is string => !!x);
}

/** 한 단위 발송 — 패키지는 bundle/send, 낱장은 PATCH status SENT. 서버가 양식 순서 고정·중복(409 DUPLICATE)·값 검증을 다시 본다 */
export async function sendUnit(u: SendUnit, approverIds: string[], opts: { message: string; deadlineDays: number; confirmDuplicate?: boolean }) {
  const body = { approverIds, sendMessage: opts.message, deadlineDays: opts.deadlineDays, ...(opts.confirmDuplicate ? { confirmDuplicate: true } : {}) };
  const res = u.bundle
    ? await fetch(`/api/contracts/bundle/${u.c.bundleId}/send`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    : await fetch(`/api/contracts/${u.c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "SENT", ...body }) });
  const d = await res.json().catch(() => ({})) as { error?: string; code?: string };
  return { res, d };
}

/**
 * 여러 단위를 차례로 보낸다. 중복 경고(#47)는 모아서 한 번만 묻는다(confirmDup 콜백). 한 건이 끊겨도 나머지는 계속.
 * 돌려주는 값: 보낸 이름, 못 보낸 「이름(이유)」, 못 보낸 계약 id(다시 고른 채로 두기용)
 */
export async function sendUnits(
  units: SendUnit[], idsOf: (u: SendUnit) => string[] | null,
  opts: { message: string; deadlineDays: number; confirmDup: (dups: SendUnit[]) => boolean },
): Promise<{ ok: string[]; fail: string[]; keep: string[] }> {
  const ok: string[] = [], fail: string[] = [], keep: string[] = [], dupUnits: SendUnit[] = [];
  const failOf = (u: SendUnit, why: string) => { fail.push(`${u.c.user.name}(${why})`); keep.push(u.c.id); };
  for (const u of units) {
    const ids = idsOf(u);
    if (!ids) { failOf(u, "본부 단계가 둘 — 개별 발송"); continue; }
    try {
      const { res, d } = await sendUnit(u, ids, opts);
      if (res.ok) ok.push(u.c.user.name);
      else if (res.status === 409 && d.code === "DUPLICATE") dupUnits.push(u);
      else failOf(u, d.error || "실패");
    } catch { failOf(u, "네트워크 오류"); }
  }
  if (dupUnits.length && opts.confirmDup(dupUnits)) {
    for (const u of dupUnits) {
      try {
        const { res, d } = await sendUnit(u, idsOf(u) ?? [], { ...opts, confirmDuplicate: true });
        if (res.ok) ok.push(u.c.user.name); else failOf(u, d.error || "실패");
      } catch { failOf(u, "네트워크 오류"); }
    }
  } else for (const u of dupUnits) failOf(u, "중복 — 보내지 않음");
  return { ok, fail, keep };
}
