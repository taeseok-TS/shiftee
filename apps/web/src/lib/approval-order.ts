// 전자계약 결재 순서 — 양식(템플릿)마다 지정(2026-10-12 개선 제안 #213-2, 디렉터 채택).
//
// 순수 모듈(prisma 없음) — 화면(템플릿 편집·발송 창·일괄 발송)과 서버(발송 검사)가 같은 규칙을 쓴다.
//  · 단계 종류: HQ(본부 — 발송 때 사람 선택) · MANAGER(원장 — 당사자 지점 메인 원장 자동) · EMPLOYEE(근로자 — 당사자 본인)
//    · EXTERNAL(외부 계약자 — 링크 서명). 외부 계약에서는 EMPLOYEE 단계가 곧 EXTERNAL 로 읽힌다(당사자가 외부인)
//  · 양식에 순서가 없으면 종전 발송 창과 같은 「본부 → 원장 → 근로자」(DEFAULT_STEPS) — 오늘 동작이 바뀌지 않는다
//  · approvalLocked(기본 true) = 발송 때 순서를 바꿀 수 없다. 사람만 고른다. false 면 발송 창에서 순서를 옮기고 단계를 더하고 뺄 수 있다
export type StepKind = "HQ" | "MANAGER" | "EMPLOYEE" | "EXTERNAL";
export type ApprovalStepSpec = { kind: StepKind };
export type ApproverRole = "ADMIN" | "MANAGER" | "EMPLOYEE";

export const STEP_KINDS: StepKind[] = ["HQ", "MANAGER", "EMPLOYEE", "EXTERNAL"];
export const KIND_LABEL: Record<StepKind, string> = { HQ: "본부", MANAGER: "원장", EMPLOYEE: "근로자", EXTERNAL: "외부 계약자" };
export const MAX_STEPS = 6;
export const DEFAULT_STEPS: ApprovalStepSpec[] = [{ kind: "HQ" }, { kind: "MANAGER" }, { kind: "EMPLOYEE" }];
export const PRESETS: { name: string; steps: ApprovalStepSpec[] }[] = [
  { name: "본부 → 원장 → 근로자", steps: [{ kind: "HQ" }, { kind: "MANAGER" }, { kind: "EMPLOYEE" }] },
  { name: "원장 → 근로자 → 본부", steps: [{ kind: "MANAGER" }, { kind: "EMPLOYEE" }, { kind: "HQ" }] },
  { name: "근로자 → 원장 → 본부", steps: [{ kind: "EMPLOYEE" }, { kind: "MANAGER" }, { kind: "HQ" }] },
  { name: "근로자 서명만", steps: [{ kind: "EMPLOYEE" }] },
];

const isKind = (v: unknown): v is StepKind => typeof v === "string" && (STEP_KINDS as string[]).includes(v);

/** 저장값(JSON) → 단계 목록. 없거나 모양이 틀리면 null(= 양식에 순서 없음 → DEFAULT_STEPS 로 본다) */
export function parseApprovalSteps(raw: unknown): ApprovalStepSpec[] | null {
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return null; } }
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_STEPS) return null;
  const out: ApprovalStepSpec[] = [];
  for (const s of v) {
    const kind = s && typeof s === "object" ? (s as { kind?: unknown }).kind : s;
    if (!isKind(kind)) return null;
    out.push({ kind });
  }
  return validateSteps(out) ? null : out;
}

/** 단계 목록이 쓸 수 있는 모양인지 — 틀리면 이유, 맞으면 null */
export function validateSteps(steps: ApprovalStepSpec[]): string | null {
  if (!steps.length) return "결재 단계가 하나 이상 있어야 합니다.";
  if (steps.length > MAX_STEPS) return `결재 단계는 ${MAX_STEPS}개까지입니다.`;
  const n = (k: StepKind) => steps.filter((s) => s.kind === k).length;
  if (n("EMPLOYEE") > 1) return "근로자 단계는 하나만 넣을 수 있습니다.";
  if (n("EXTERNAL") > 1) return "외부 계약자 단계는 하나만 넣을 수 있습니다.";
  if (n("EMPLOYEE") && n("EXTERNAL")) return "근로자 단계와 외부 계약자 단계를 함께 넣을 수 없습니다(외부 계약은 근로자 단계가 외부 계약자로 읽힙니다).";
  if (n("MANAGER") > 2) return "원장 단계는 둘까지입니다.";
  if (n("HQ") > 3) return "본부 단계는 셋까지입니다.";
  return null;
}

export function stepsLabel(steps: ApprovalStepSpec[] | null | undefined, external = false): string {
  return (steps && steps.length ? steps : DEFAULT_STEPS).map((s) => KIND_LABEL[effectiveKind(s.kind, external)]).join(" → ");
}

/** 외부 계약이면 근로자 단계는 외부 계약자 단계다 */
export function effectiveKind(kind: StepKind, external: boolean): StepKind {
  return external && kind === "EMPLOYEE" ? "EXTERNAL" : kind;
}

export type OrderContext = {
  contractUserId: string;       // 계약 당사자(외부 계약이면 작성 관리자)
  external: boolean;            // 외부(미가입) 계약
  partyIsManager?: boolean;     // 당사자가 원장(원장 본인의 계약서) — 원장 단계를 비울 수 있다
};
export type RoleOf = (id: string) => ApproverRole | null | undefined;

/** 결재자 id 하나가 어느 종류의 단계인가. OTHER = 본부·원장·당사자 아닌 사람(고정 순서에선 허용하지 않는다) */
export function kindOfApprover(id: string, ctx: OrderContext, roleOf: RoleOf): StepKind | "OTHER" {
  if (id === "EXTERNAL") return "EXTERNAL";
  if (id === ctx.contractUserId && !ctx.external) return "EMPLOYEE";
  const role = roleOf(id);
  if (role === "ADMIN") return "HQ";
  if (role === "MANAGER") return "MANAGER";
  return "OTHER";
}

/**
 * 발송 결재자 목록이 양식 순서와 맞는가(고정 양식에서만 부른다).
 *  · 같은 순서·같은 종류여야 한다
 *  · 당사자가 원장이면(원장 본인의 계약서) 원장 단계 하나를 비운 순서도 맞는 것으로 본다 — 같은 사람이 두 번 결재할 수 없다(#159 검증 M1)
 */
export function checkOrder(approverIds: string[], steps: ApprovalStepSpec[], ctx: OrderContext, roleOf: RoleOf): { ok: boolean; error?: string } {
  const expected = steps.map((s) => effectiveKind(s.kind, ctx.external));
  const got = approverIds.map((id) => kindOfApprover(id, ctx, roleOf));
  const bad = got.findIndex((k) => k === "OTHER");
  if (bad >= 0) return { ok: false, error: `${bad + 1}단계 결재자는 본부·원장·당사자 중에서 골라야 합니다(이 양식은 결재 순서가 고정입니다).` };
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  if (same(got as string[], expected)) return { ok: true };
  if (ctx.partyIsManager) {
    const i = expected.indexOf("MANAGER");
    if (i >= 0 && same(got as string[], [...expected.slice(0, i), ...expected.slice(i + 1)])) return { ok: true };
  }
  const label = (ks: string[]) => ks.map((k) => (k === "OTHER" ? "기타" : KIND_LABEL[k as StepKind])).join(" → ");
  return { ok: false, error: `이 양식의 결재 순서는 「${label(expected)}」입니다. 보낸 순서 「${label(got as string[])}」와 다릅니다. 양식에서 순서를 바꾸거나 「발송 때 순서 변경 허용」을 켜 주세요.` };
}
