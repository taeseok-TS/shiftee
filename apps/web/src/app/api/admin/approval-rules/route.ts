import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { kstTodayMidnight } from "@/lib/resign";
import { readApprovalRules, saveApprovalRules } from "@/lib/approval-rules";
import { hiddenIdsFor } from "@/lib/hidden-accounts";
import {
  RULE_ROWS, ROW_BY_KEY, rowSteps, validateRow, validateException, cleanException, cleanSteps, duplicateExceptionError, describeSteps,
  EXCEPTION_KIND_LABEL, MAX_EXCEPTIONS, type ApprovalRules, type RuleStep, type RuleException,
} from "@/lib/approval-rules-core";

// 결재 규칙(2026-10-15 QA76 #16) — 조회·저장은 관리자. 저장은 통째로(rev 로 동시 저장 충돌을 막는다), 바뀐 줄만 감사 기록
async function lookups() {
  const [people, branches] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true, deletedAt: null, OR: [{ resignDate: null }, { resignDate: { gte: kstTodayMidnight() } }] },   // 퇴사일이 지난 사람 제외
      select: { id: true, name: true, role: true, branch: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    prisma.branch.findMany({ where: { isActive: true }, select: { name: true }, orderBy: { name: "asc" } }),
  ]);
  return { people, branches: branches.map((b) => b.name) };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 볼 수 있습니다." }, { status: 403 });
  const [rules, lk, hidden] = await Promise.all([readApprovalRules(), lookups(), hiddenIdsFor(session)]);
  // 개발자 영역(메인 관리자)은 사람 목록(지정 결재자 후보)에서 뺀다 — 보는 사람만 본다(2026-10-17 디렉터).
  // 단 **이미 규칙에 걸려 있는 사람은 남긴다** — 빠지면 화면이 「(없는 사람)」으로 그려 멀쩡한 규칙을 다시 고르게 만든다.
  // 저장(PUT) 검사는 lookups() 전체 명단으로 하므로 결재 동작은 그대로다
  if (hidden.length) {
    const used = new Set<string>([
      ...Object.values(rules.rows).flat().map((st) => st.userId),
      ...rules.exceptions.flatMap((x) => [x.userId, ...x.steps.map((st) => st.userId)]),
    ].filter((v): v is string => !!v));
    lk.people = lk.people.filter((p) => !hidden.includes(p.id) || used.has(p.id));
  }
  return NextResponse.json({ rules, rows: RULE_ROWS, ...lk });
}

function stepsEqual(a: RuleStep[], b: RuleStep[]) {
  return a.length === b.length && a.every((s, i) => s.type === b[i].type && (s.userId ?? "") === (b[i].userId ?? ""));
}

export async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "관리자만 바꿀 수 있습니다." }, { status: 403 });
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return NextResponse.json({ error: "요청 본문이 올바르지 않습니다." }, { status: 400 });
  const body = raw as { rev?: unknown; rows?: unknown; exceptions?: unknown };
  if (typeof body.rev !== "number") return NextResponse.json({ error: "rev 가 필요합니다." }, { status: 400 });

  // 규칙 표 — 기본값과 같은 줄은 저장하지 않는다(기본값이 바뀌면 따라가게)
  const rows: Record<string, RuleStep[]> = {};
  if (body.rows != null) {
    if (typeof body.rows !== "object" || Array.isArray(body.rows)) return NextResponse.json({ error: "rows 모양이 올바르지 않습니다." }, { status: 400 });
    for (const [k, v] of Object.entries(body.rows as Record<string, unknown>)) {
      const row = ROW_BY_KEY[k];
      if (!row) return NextResponse.json({ error: `없는 규칙입니다: ${k}` }, { status: 400 });
      if (row.locked) continue;
      const steps = cleanSteps(v);
      if (!steps) return NextResponse.json({ error: `[${row.label} · ${row.targetLabel}] 결재 단계 모양이 올바르지 않습니다.` }, { status: 400 });
      const err = validateRow(k, steps);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      if (!stepsEqual(steps, row.def)) rows[k] = steps;
    }
  }
  // 예외 결재선
  const exceptions: RuleException[] = [];
  if (body.exceptions != null) {
    if (!Array.isArray(body.exceptions)) return NextResponse.json({ error: "exceptions 모양이 올바르지 않습니다." }, { status: 400 });
    if (body.exceptions.length > MAX_EXCEPTIONS) return NextResponse.json({ error: `예외는 ${MAX_EXCEPTIONS}개까지입니다.` }, { status: 400 });
    for (const x of body.exceptions) {
      const ex = cleanException(x);
      if (!ex) return NextResponse.json({ error: "예외 결재선 한 줄의 모양이 올바르지 않습니다." }, { status: 400 });
      const err = validateException(ex);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      exceptions.push(ex);
    }
    const dup = duplicateExceptionError(exceptions);
    if (dup) return NextResponse.json({ error: dup }, { status: 400 });
  }
  // 사람·지점이 실제로 있는지 — 결재자는 관리자·원장만
  const { people, branches } = await lookups();
  const byId = new Map(people.map((p) => [p.id, p]));
  const stepUsers = [...Object.values(rows).flat(), ...exceptions.flatMap((x) => x.steps)].filter((s) => s.type === "USER").map((s) => s.userId!);
  for (const id of stepUsers) {
    const p = byId.get(id);
    if (!p || (p.role !== "ADMIN" && p.role !== "MANAGER")) return NextResponse.json({ error: "결재자로 고른 사람 중 퇴사했거나 관리자·원장이 아닌 사람이 있습니다. 「(없는 사람)」으로 보이는 단계를 다시 고르세요." }, { status: 400 });
  }
  for (const x of exceptions) {
    if (x.targetType === "USER" && !byId.has(x.userId!)) return NextResponse.json({ error: "예외 대상 직원 중 퇴사·비활성인 사람이 있습니다. 예외 표에서 「(없는 직원)」 줄을 지운 뒤 저장하세요." }, { status: 400 });
    if (x.targetType === "USER" && byId.get(x.userId!)?.role === "ADMIN") return NextResponse.json({ error: "관리자 본인의 신청은 예외 대상이 아닙니다(다른 관리자 1명이 결재)." }, { status: 400 });
    if (x.targetType === "BRANCH" && !branches.includes(x.branch!)) return NextResponse.json({ error: `지점 「${x.branch}」을 찾을 수 없습니다(닫힌 지점). 예외 표에서 그 줄을 지운 뒤 저장하세요.` }, { status: 400 });
  }

  const before = await readApprovalRules();
  const next: ApprovalRules = { v: 1, rev: before.rev, rows, exceptions };
  const saved = await saveApprovalRules(next, body.rev);
  if ("current" in saved) return NextResponse.json({ code: "CONFLICT", error: "그 사이 다른 관리자가 결재 규칙을 바꿨습니다. 새로 불러온 뒤 다시 바꿔 주세요.", rules: saved.current }, { status: 409 });

  // 감사 기록 — 바뀐 줄·예외만
  const nameOf = (id: string) => byId.get(id)?.name;
  const changes: string[] = [];
  for (const row of RULE_ROWS) {
    if (row.locked) continue;
    const a = rowSteps(before, row.key), b = rowSteps(saved.rules, row.key);
    if (!stepsEqual(a, b)) changes.push(`${row.label}·${row.targetLabel}${row.condition && row.condition !== "—" ? `(${row.condition.split(" · ")[0]})` : ""} 「${describeSteps(a, nameOf)}」→「${describeSteps(b, nameOf)}」`);
  }
  const exLabel = (x: RuleException) => `${x.targetType === "USER" ? nameOf(x.userId!) ?? "직원" : `${x.branch} 지점`} ${x.kinds.map((k) => EXCEPTION_KIND_LABEL[k]).join("·")} 「${describeSteps(x.steps, nameOf)}」`;
  const sig = (x: RuleException) => JSON.stringify([x.targetType, x.userId ?? x.branch, [...x.kinds].sort(), x.steps]);
  const beforeSigs = new Set(before.exceptions.map(sig)), afterSigs = new Set(exceptions.map(sig));
  for (const x of before.exceptions) if (!afterSigs.has(sig(x))) changes.push(`예외 삭제: ${exLabel(x)}`);
  for (const x of exceptions) if (!beforeSigs.has(sig(x))) changes.push(`예외 추가: ${exLabel(x)}`);
  if (changes.length) {
    await logAudit({
      actorId: session.userId, actorName: session.name, action: "APPROVAL_RULES_UPDATE",
      targetType: "AppSetting", targetId: "approvalRules", targetName: "결재 규칙", detail: changes.join(" · ").slice(0, 1900),
    }).catch(() => {});
  }
  return NextResponse.json({ success: true, rules: saved.rules, changed: changes.length > 0 });
}
