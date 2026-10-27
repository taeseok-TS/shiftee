// ─── 결재 규칙(2026-10-15 QA76 #16 「결재 규칙 편집 화면」, 디렉터 지시) — 순수 모듈 ─────────────────
// 화면(결재 규칙 편집)과 서버(lib/approval-rules.ts 의 결재선 만들기)가 같은 표·같은 검사를 쓴다. prisma 없음.
//
//  · 규칙 표: 요청 종류 × 대상(직원·원장) × 조건 마다 한 줄. 줄은 미리 정해진 목록(RULE_ROWS)이고 결재 단계만 바꾼다.
//    줄을 사람이 더하고 빼지 않으므로 「어느 규칙이 먼저인가」 다툼이 없다. 예외는 아래 예외 결재선으로 한다.
//  · 예외 결재선: 직원 한 명 또는 지점 하나에 대해 휴가·근무일정 결재선을 따로 정한다(직원 > 지점 > 규칙 표 순).
//  · 저장은 AppSetting "approvalRules" 한 줄(JSON). 없으면 기본값(DEFAULT) = 종전 코드와 같은 결재선.
//    단 근무일정 「직원 · 주말·공휴일 포함」은 디렉터 결정(10/15)으로 원장 1단계가 기본이다(종전 원장 → 본부).
//  · 규칙을 바꿔도 이미 대기 중인 건은 그대로 간다(결재선은 신청할 때 만들어 저장한다 — 디렉터 결정 10/15).
//  · 관리자(본부) 본인의 신청은 표 밖이다 — 다른 관리자 1명(없으면 자동 승인), 종전 그대로.

export type StepType = "BRANCH_MANAGER" | "HQ" | "USER" | "PEER_MANAGER";
export type RuleStep = { type: StepType; userId?: string };
export type RequestKind = "LEAVE" | "SCHEDULE" | "ATT_OUTSIDE" | "ATT_PHOTO" | "ATT_CORRECTION" | "ATT_MISSED_OUT" | "ATT_MANAGER" | "ATT_HQ" | "ATT_DEVICE";

export const STEP_LABEL: Record<StepType, string> = {
  BRANCH_MANAGER: "지점 원장",
  HQ: "본부(관리자 누구나)",
  USER: "지정한 사람",
  PEER_MANAGER: "같은 지점 대표원장",   // 화면 이름 「대표원장」(2026-10-23 본부 요청) — 코드 · 필드 이름은 mainManager 그대로
};
export const STEP_HINT: Record<StepType, string> = {
  BRANCH_MANAGER: "신청자 소속 지점의 원장(겸직 원장 포함). 원장이 없거나 공석이면 원장대행, 그것도 없으면 이 단계는 건너뜁니다.",
  HQ: "메인·서브 관리자 누구나 결재합니다.",
  USER: "고른 사람만 결재합니다(원장대행은 대신하지 않음, 관리자는 늘 대신 처리 가능). 그 사람이 신청자 본인이거나 퇴사했으면 건너뜁니다.",
  PEER_MANAGER: "원장이 신청할 때 — 그 지점 대표원장(없으면 같은 지점의 다른 원장). 겸직 원장 · 대표원장 본인이면 건너뜁니다.",
};

export type RuleRow = {
  key: string;
  kind: RequestKind;
  label: string;        // 요청 종류
  target: "EMPLOYEE" | "MANAGER" | "ALL";
  targetLabel: string;  // 대상
  condition: string;    // 조건
  maxSteps: number;     // 출퇴근 요청은 한 단계뿐(요청 표에 결재자 칸이 하나) — 출퇴근 수정만 두 단계(원장 → 본부)
  allowed: StepType[];  // 고를 수 있는 단계
  def: RuleStep[];      // 기본값(= 종전 동작)
  locked?: string;      // 바꿀 수 없는 줄 — 이유
  hqLast?: string;      // 마지막 단계가 본부여야 하는 줄 — 이유(출퇴근 시각은 본부만 확인한다, 2026-10-23 ■0-11)
};

const B: RuleStep = { type: "BRANCH_MANAGER" };
const H: RuleStep = { type: "HQ" };
const P: RuleStep = { type: "PEER_MANAGER" };

export const RULE_ROWS: RuleRow[] = [
  { key: "LEAVE.EMPLOYEE", kind: "LEAVE", label: "휴가", target: "EMPLOYEE", targetLabel: "직원(원장 제외)", condition: "일수 상관없이 · 휴가 취소 요청도 같은 결재선",
    maxSteps: 3, allowed: ["BRANCH_MANAGER", "HQ", "USER"], def: [B, H] },
  { key: "LEAVE.MANAGER", kind: "LEAVE", label: "휴가", target: "MANAGER", targetLabel: "원장", condition: "— · 휴가 취소 요청도 같은 결재선",
    maxSteps: 3, allowed: ["HQ", "USER", "PEER_MANAGER"], def: [H] },
  { key: "SCHEDULE.EMPLOYEE.HOLIDAY", kind: "SCHEDULE", label: "근무 변경", target: "EMPLOYEE", targetLabel: "직원", condition: "주말·공휴일 근무 포함(휴일근무)",
    maxSteps: 3, allowed: ["BRANCH_MANAGER", "HQ", "USER"], def: [B] },
  { key: "SCHEDULE.EMPLOYEE.WEEKDAY", kind: "SCHEDULE", label: "근무 변경", target: "EMPLOYEE", targetLabel: "직원", condition: "평일만(연장·야간·과거 날짜 포함)",
    maxSteps: 3, allowed: ["BRANCH_MANAGER", "HQ", "USER"], def: [B] },
  { key: "SCHEDULE.MANAGER", kind: "SCHEDULE", label: "근무 변경", target: "MANAGER", targetLabel: "원장", condition: "—",
    maxSteps: 3, allowed: ["PEER_MANAGER", "HQ", "USER"], def: [P, H] },
  { key: "ATT_OUTSIDE.EMPLOYEE", kind: "ATT_OUTSIDE", label: "지점 밖 출퇴근", target: "EMPLOYEE", targetLabel: "직원", condition: "본사·서점·외근 등",
    maxSteps: 1, allowed: ["BRANCH_MANAGER", "HQ"], def: [B] },
  { key: "ATT_PHOTO.EMPLOYEE", kind: "ATT_PHOTO", label: "사진 출퇴근", target: "EMPLOYEE", targetLabel: "직원", condition: "위치 인증 3번 실패 뒤",
    maxSteps: 1, allowed: ["BRANCH_MANAGER", "HQ"], def: [B] },
  // 출퇴근 수정 두 줄은 「지점 원장 → 본부」(2026-10-23 ■0-11) — 원장은 상태만 보고 1차 승인, 넣을 시각은 본부가 확인해 최종 승인.
  // 종전 저장값 [지점 원장] 한 단계는 검사(hqLast)에 걸려 버려지고 기본값으로 돌아온다
  { key: "ATT_CORRECTION.EMPLOYEE", kind: "ATT_CORRECTION", label: "출퇴근 수정", target: "EMPLOYEE", targetLabel: "직원", condition: "지각·누락 수정",
    maxSteps: 2, allowed: ["BRANCH_MANAGER", "HQ"], def: [B, H], hqLast: "출퇴근 시각은 본부가 확인하므로 마지막 단계는 본부여야 합니다." },
  { key: "ATT_MISSED_OUT.EMPLOYEE", kind: "ATT_MISSED_OUT", label: "퇴근 누락", target: "EMPLOYEE", targetLabel: "직원", condition: "전날 퇴근을 안 찍음",
    maxSteps: 2, allowed: ["BRANCH_MANAGER", "HQ"], def: [B, H], hqLast: "출퇴근 시각은 본부가 확인하므로 마지막 단계는 본부여야 합니다." },
  { key: "ATT_MANAGER", kind: "ATT_MANAGER", label: "출퇴근 요청(위 4종)", target: "MANAGER", targetLabel: "원장", condition: "—",
    maxSteps: 1, allowed: ["HQ"], def: [H], locked: "원장의 출퇴근 요청은 본부가 처리합니다." },   // 본부 답변 #5
  { key: "ATT_HQ", kind: "ATT_HQ", label: "본부 출퇴근 처리", target: "ALL", targetLabel: "전 직원", condition: "위치 인증 실패 뒤 본부에 요청",
    maxSteps: 1, allowed: ["HQ"], def: [H], locked: "본부에 직접 맡기는 요청이라 본부만 처리합니다." },
  { key: "ATT_DEVICE", kind: "ATT_DEVICE", label: "기기 변경", target: "ALL", targetLabel: "전 직원", condition: "—",
    maxSteps: 1, allowed: ["HQ"], def: [H], locked: "기기 변경은 본부만 승인합니다." },   // 본부 답변 #6
];
export const ROW_BY_KEY: Record<string, RuleRow> = Object.fromEntries(RULE_ROWS.map((r) => [r.key, r]));

export type ExceptionKind = "LEAVE" | "SCHEDULE";
export const EXCEPTION_KIND_LABEL: Record<ExceptionKind, string> = { LEAVE: "휴가(취소 포함)", SCHEDULE: "근무일정" };
export type RuleException = {
  id: string;
  targetType: "USER" | "BRANCH";
  userId?: string;
  branch?: string;
  kinds: ExceptionKind[];
  steps: RuleStep[];
  note?: string;
};
export const EXCEPTION_ALLOWED: StepType[] = ["BRANCH_MANAGER", "HQ", "USER"];
export const MAX_EXCEPTIONS = 60;
export const MAX_STEPS = 3;

export type ApprovalRules = { v: 1; rev: number; rows: Record<string, RuleStep[]>; exceptions: RuleException[] };

export function defaultRules(): ApprovalRules {
  return { v: 1, rev: 0, rows: {}, exceptions: [] };
}

/** 이 줄에 지금 적용되는 단계 — 저장값이 없거나 잠긴 줄이면 기본값 */
export function rowSteps(rules: ApprovalRules, key: string): RuleStep[] {
  const row = ROW_BY_KEY[key];
  if (!row) return [];
  if (row.locked) return row.def;
  return rules.rows[key] ?? row.def;
}

const isStepType = (v: unknown): v is StepType => v === "BRANCH_MANAGER" || v === "HQ" || v === "USER" || v === "PEER_MANAGER";
const ID_RE = /^[a-z0-9]{10,40}$/i;

/** 저장·요청값 → 단계 목록(모양만 검사). 틀리면 null */
export function cleanSteps(raw: unknown): RuleStep[] | null {
  if (!Array.isArray(raw)) return null;
  const out: RuleStep[] = [];
  for (const s of raw) {
    if (!s || typeof s !== "object") return null;
    const t = (s as { type?: unknown }).type;
    if (!isStepType(t)) return null;
    if (t === "USER") {
      const u = (s as { userId?: unknown }).userId;
      if (typeof u !== "string" || !ID_RE.test(u)) return null;
      out.push({ type: t, userId: u });
    } else out.push({ type: t });
  }
  return out;
}

/** 단계 목록 검사 — 틀리면 이유, 맞으면 null */
export function validateSteps(steps: RuleStep[], allowed: StepType[], maxSteps: number, needFinal = false): string | null {
  if (!steps.length) return "결재 단계가 하나 이상 있어야 합니다.";
  if (steps.length > maxSteps) return `결재 단계는 ${maxSteps}개까지입니다.`;
  for (const s of steps) if (!allowed.includes(s.type)) return `「${STEP_LABEL[s.type]}」 단계는 여기에 넣을 수 없습니다.`;
  if (steps.some((s) => s.type === "USER" && !s.userId)) return "「지정한 사람」 단계의 결재자를 고르세요.";
  const seen = new Set<string>();
  for (const s of steps) {
    const k = s.type === "USER" ? `U:${s.userId}` : s.type;
    if (seen.has(k)) return "같은 결재자를 두 번 넣을 수 없습니다.";
    seen.add(k);
  }
  // 원장이 신청하는 줄은 원장끼리만으로 끝나면 안 된다 — 본부나 지정한 사람이 하나는 있어야 한다
  if (needFinal && !steps.some((s) => s.type === "HQ" || s.type === "USER")) return "원장 신청은 본부 또는 지정한 사람 단계가 하나 있어야 합니다.";
  return null;
}

export function validateRow(key: string, steps: RuleStep[]): string | null {
  const row = ROW_BY_KEY[key];
  if (!row) return "없는 규칙입니다.";
  if (row.locked) return row.locked;
  const e = validateSteps(steps, row.allowed, row.maxSteps, row.target === "MANAGER")
    ?? (row.hqLast && steps[steps.length - 1]?.type !== "HQ" ? row.hqLast : null);
  return e ? `[${row.label} · ${row.targetLabel}${row.condition && row.condition !== "—" ? ` · ${row.condition.split(" · ")[0]}` : ""}] ${e}` : null;
}

export function validateException(x: RuleException): string | null {
  const who = x.targetType === "USER" ? "직원 예외" : `지점 「${x.branch ?? ""}」 예외`;
  if (x.targetType === "USER" && !x.userId) return `${who}: 대상 직원을 고르세요.`;
  if (x.targetType === "BRANCH" && !x.branch) return `${who}: 대상 지점을 고르세요.`;
  if (!x.kinds.length) return `${who}: 적용할 요청(휴가·근무일정)을 하나 이상 고르세요.`;
  if (x.targetType === "USER" && x.steps.some((s) => s.type === "USER" && s.userId === x.userId)) return `${who}: 본인을 결재자로 넣을 수 없습니다.`;
  const e = validateSteps(x.steps, EXCEPTION_ALLOWED, MAX_STEPS);
  return e ? `${who}: ${e}` : null;
}

/** 저장값(JSON) → 규칙. 모르는 줄·깨진 줄은 버린다(= 기본값). 통째로 깨졌으면 기본값 */
export function parseRules(raw: unknown): ApprovalRules {
  const out = defaultRules();
  let v = raw;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return out; } }
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  const o = v as Record<string, unknown>;
  if (typeof o.rev === "number" && Number.isFinite(o.rev)) out.rev = Math.max(0, Math.floor(o.rev));
  if (o.rows && typeof o.rows === "object" && !Array.isArray(o.rows)) {
    for (const [k, s] of Object.entries(o.rows as Record<string, unknown>)) {
      const steps = cleanSteps(s);
      if (steps && !validateRow(k, steps)) out.rows[k] = steps;
    }
  }
  if (Array.isArray(o.exceptions)) {
    for (const x of o.exceptions.slice(0, MAX_EXCEPTIONS)) {
      const ex = cleanException(x);
      if (ex && !validateException(ex)) out.exceptions.push(ex);
    }
  }
  return out;
}

export function cleanException(x: unknown): RuleException | null {
  if (!x || typeof x !== "object") return null;
  const r = x as Record<string, unknown>;
  const targetType = r.targetType === "USER" ? "USER" : r.targetType === "BRANCH" ? "BRANCH" : null;
  if (!targetType) return null;
  const steps = cleanSteps(r.steps);
  if (!steps) return null;
  const kinds = Array.isArray(r.kinds) ? [...new Set(r.kinds.filter((k): k is ExceptionKind => k === "LEAVE" || k === "SCHEDULE"))] : [];
  const id = typeof r.id === "string" && /^[a-z0-9-]{4,40}$/i.test(r.id) ? r.id : null;
  if (!id) return null;
  const ex: RuleException = { id, targetType, kinds, steps };
  if (targetType === "USER") { if (typeof r.userId !== "string" || !ID_RE.test(r.userId)) return null; ex.userId = r.userId; }
  else { if (typeof r.branch !== "string" || !r.branch.trim() || r.branch.length > 40) return null; ex.branch = r.branch.trim(); }
  if (typeof r.note === "string" && r.note.trim()) ex.note = r.note.trim().slice(0, 100);
  return ex;
}

/** 같은 대상·같은 요청에 예외가 둘이면 어느 것을 쓸지 모른다 — 막는다 */
export function duplicateExceptionError(list: RuleException[]): string | null {
  const seen = new Set<string>();
  for (const x of list) for (const k of x.kinds) {
    const key = `${x.targetType}:${x.targetType === "USER" ? x.userId : x.branch}:${k}`;
    if (seen.has(key)) return `같은 ${x.targetType === "USER" ? "직원" : "지점"}에 ${EXCEPTION_KIND_LABEL[k]} 예외가 두 개 있습니다. 하나로 합치세요.`;
    seen.add(key);
  }
  return null;
}

/** 사람이 읽는 결재선 — 「지점 원장 → 본부」. USER 단계는 이름표 함수로 */
export function describeSteps(steps: RuleStep[], nameOf: (id: string) => string | undefined): string {
  return steps.map((s) => (s.type === "USER" ? (s.userId && nameOf(s.userId)) || "(없는 사람)" : s.type === "HQ" ? "본부" : STEP_LABEL[s.type])).join(" → ");
}
