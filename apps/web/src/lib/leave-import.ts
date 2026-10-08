import { prisma } from "@/lib/db";
import { LEAVE_CATALOG, leaveInfo, leaveLabel } from "@/lib/leave-catalog";
import { isLeaveDeductible } from "@/lib/leave-types";
import { leaveYearOfLeave } from "@/lib/leave-calc";
import { deductLeaveBalance, restoreLeaveBalance } from "@/lib/leave-balance";
import { getHolidaySet, ymdUTC } from "@/lib/holidays";
import { logAudit } from "@/lib/audit";

// ─── 시프티 휴가 사용 내역 가져오기(2026-10-08 QA76 #2) ─────────────────────
// 본부가 시프티에서 내려받은 엑셀(열 구성은 화면에서 맞춘다)을 직원·유형과 대조해 **승인 완료** 휴가로 넣는다.
//  · 직원 매칭: 사번 → 이메일 → 이름(재직·미삭제 중 한 명일 때만). 사번·이메일로 찾았는데 파일 이름과 다르면 건너뛴다(확인 필요)
//  · 유형 매칭: 큐브티 유형 이름과 시프티 이름(별칭표). 못 맞추면 화면에서 골라 준다(typeOverride)
//  · 일수: 파일에 있으면 그 값(달력 일수를 넘으면 오류), 없으면 휴가 신청과 같은 규칙(반차 0.5·반반차 0.25·그 밖은 주말·공휴일 뺀 근무일).
//    반차류는 하루만·주말·공휴일 불가, 기간에 근무일이 없으면 오류 — 휴가 신청(api/leave POST)과 같다
//  · 상태 열이 있으면 승인 아닌 행(반려·취소·철회·대기)은 건너뛴다
//  · 중복: 같은 직원의 진행·승인 휴가와 날짜가 겹치면 건너뛴다. 파일 안에서도 겹치면 뒤 행을 건너뛴다(같은 날 오전·오후 반차처럼 하루 미만 유형끼리만 허용)
//  · 적용: 미리보기를 서버가 다시 돌린 뒤 행마다 트랜잭션 — status APPROVED, 본부 승인 단계 1개(「시프티 이관」), 사유 앞 「[시프티 이관]」, importBatch.
//    deduct 가 참이면 연차 차감 유형을 그 해 연차에서 차감(잔여를 시프티 기준으로 이미 맞췄다면 끄고 기록만 넣는다 — 디렉터 결정 사항)
//  · 되돌리기: 배치의 휴가를 지우고 차감했던 것을 복구한다(진행 중인 취소 요청이 걸린 건은 두고 알린다)
export type ImportRow = { empNo?: string | number | null; name?: string | null; email?: string | null; type?: string | null; startDate?: string | null; endDate?: string | null; days?: string | number | null; reason?: string | null; status?: string | null; typeOverride?: string | null };
export type ImportStatus = "ok" | "applied" | "user_not_found" | "user_ambiguous" | "user_mismatch" | "type_unknown" | "invalid" | "duplicate" | "status_skip";
export type ImportResult = {
  i: number; name: string; matched: { userId: string; name: string; branch: string | null } | null;
  typeText: string; typeCode: string | null; typeLabel: string | null; startDate: string; endDate: string; days: number | null; reason: string;
  status: ImportStatus; message: string;
};

const ALIASES: Record<string, string> = {
  "반차": "HALF_AM", "오전반차": "HALF_AM", "오후반차": "HALF_PM", "반반차": "QUARTER_AM", "오전반반차": "QUARTER_AM", "오후반반차": "QUARTER_PM",
  "연차휴가": "ANNUAL", "연차": "ANNUAL", "대체휴무": "COMPENSATORY", "대체휴무반차": "COMPENSATORY_HALF", "대체휴일반차": "COMPENSATORY_HALF", "보상휴가반차": "COMP_LEAVE_HALF",
  "민방위": "CIVIL_DEFENSE", "민방위휴가": "CIVIL_DEFENSE", "예비군": "RESERVE_FORCES", "예비군휴가": "RESERVE_FORCES", "예비군훈련": "RESERVE_FORCES",
  "기타휴가유급": "OTHER_PAID", "기타휴가무급": "OTHER_UNPAID", "무급휴가": "OTHER_UNPAID", "경조사": "FAMILY_EVENT", "경조": "FAMILY_EVENT", "경조사휴가": "FAMILY_EVENT", "병가": "SICK",
  "배우자출산": "SPOUSE_BIRTH", "가족돌봄": "FAMILY_CARE", "태아검진": "PRENATAL_CHECKUP", "출산": "MATERNITY", "포상": "REWARD",
};
const norm = (s: string) => s.replace(/[\s()_\-·]/g, "").toLowerCase();
const BY_LABEL = new Map(LEAVE_CATALOG.map((t) => [norm(t.label), t.code]));
const CODES = new Set(LEAVE_CATALOG.map((t) => t.code));
const NOT_APPROVED = /반려|취소|철회|거절|대기|삭제|reject|cancel|pending|withdraw/i;

/** 시프티 유형 이름 → 큐브티 코드. 못 맞추면 null */
export function resolveLeaveType(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (CODES.has(t)) return t;
  const n = norm(t);
  return BY_LABEL.get(n) ?? ALIASES[n] ?? null;
}

const toYmd = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  const m = /^(\d{4})[.\-/년 ]\s*(\d{1,2})[.\-/월 ]\s*(\d{1,2})일?/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return ymdUTC(dt);
};
const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
const spanDays = (s: string, e: string) => Math.round((dateOf(e).getTime() - dateOf(s).getTime()) / 86400000) + 1;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (v == null ? "" : String(v).trim());

/** 미리보기 — 행마다 직원·유형·일수·중복을 판정한다(쓰지 않는다) */
export async function previewLeaveImport(rowsIn: unknown[]): Promise<ImportResult[]> {
  const rows: ImportRow[] = rowsIn.map((r) => (isObj(r) ? (r as ImportRow) : {}));
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true, empNo: true, branch: true, isActive: true },
  });
  const byEmpNo = new Map(users.filter((u) => u.empNo != null).map((u) => [u.empNo as number, u]));
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const byName = new Map<string, typeof users>();
  for (const u of users) { if (!u.isActive) continue; const k = norm(u.name); byName.set(k, [...(byName.get(k) ?? []), u]); }

  const out: ImportResult[] = rows.map((r, i) => {
    const name = str(r.name);
    const typeText = str(r.type);
    const reason = str(r.reason);
    const base: ImportResult = { i, name, matched: null, typeText, typeCode: null, typeLabel: null, startDate: toYmd(r.startDate) ?? str(r.startDate), endDate: toYmd(r.endDate ?? r.startDate) ?? str(r.endDate), days: null, reason, status: "ok", message: "" };
    // 상태 열 — 승인이 아닌 행은 건너뛴다
    const st = str(r.status);
    if (st && NOT_APPROVED.test(st)) return { ...base, status: "status_skip", message: `상태 「${st}」 — 승인된 건만 가져옵니다` };
    // 직원 — 사번·이메일로 찾았으면 파일 이름과 대조(큐브티 사번은 큐브티가 매긴 번호라 시프티와 다를 수 있다)
    let user: (typeof users)[number] | undefined; let how = "";
    const empNoText = str(r.empNo);
    const empNo = /^\d+$/.test(empNoText) ? Number(empNoText) : 0;
    if (empNo > 0) { user = byEmpNo.get(empNo); how = "사번"; }
    if (!user && r.email) { user = byEmail.get(str(r.email).toLowerCase()); how = "이메일"; }
    if (user && name && norm(user.name) !== norm(name))
      return { ...base, matched: { userId: user.id, name: user.name, branch: user.branch }, status: "user_mismatch", message: `${how}으로 찾은 직원(${user.name})과 파일 이름(${name})이 다름 — 확인 필요` };
    if (!user && name) {
      const c = byName.get(norm(name)) ?? [];
      if (c.length > 1) return { ...base, status: "user_ambiguous", message: `같은 이름 ${c.length}명 — 사번이나 이메일 열을 넣어 주세요` };
      user = c[0];
    }
    if (!user) return { ...base, status: "user_not_found", message: "직원을 찾지 못함(사번·이메일·이름)" };
    const matched = { userId: user.id, name: user.name, branch: user.branch };
    // 유형
    const ov = str(r.typeOverride);
    const typeCode = (ov && CODES.has(ov) ? ov : null) ?? resolveLeaveType(typeText);
    if (!typeCode) return { ...base, matched, status: "type_unknown", message: `유형 「${typeText || "(비어 있음)"}」을 큐브티 유형에 맞춰 주세요` };
    const info = leaveInfo(typeCode)!;
    const typed: ImportResult = { ...base, matched, typeCode, typeLabel: leaveLabel(typeCode) };
    // 날짜
    const s = toYmd(r.startDate), e = toYmd(r.endDate ?? r.startDate);
    if (!s || !e || s > e) return { ...typed, status: "invalid", message: "날짜 형식(예: 2026-05-01) 또는 순서가 잘못됨" };
    const withDates = { ...typed, startDate: s, endDate: e };
    if (info.unit !== "FULL" && s !== e) return { ...withDates, status: "invalid", message: `${info.label}은(는) 하루만` };
    if (spanDays(s, e) > 366) return { ...withDates, status: "invalid", message: "기간이 1년을 넘음" };
    const daysText = str(r.days).replace(/일$/, "").replace(/,(?=\d{3})/g, "");   // 「1,000」 식 천 단위 쉼표만 뗀다(「1,5」는 오류로)
    const daysIn = daysText === "" ? null : Number(daysText);
    if (daysIn != null && (!Number.isFinite(daysIn) || daysIn <= 0 || daysIn > spanDays(s, e))) return { ...withDates, status: "invalid", message: "일수가 올바르지 않음(기간보다 크거나 숫자가 아님)" };
    return { ...withDates, days: daysIn, status: "ok", message: "" };
  });

  const okRows = out.filter((r) => r.status === "ok");
  if (!okRows.length) return out;
  // 근무일 — 주말·공휴일 뺀 날 수. 공휴일은 전체 범위를 한 번에 읽는다
  const minS = okRows.map((r) => r.startDate).sort()[0], maxE = okRows.map((r) => r.endDate).sort().at(-1)!;
  const holidays = await getHolidaySet(dateOf(minS), dateOf(maxE));
  const workDays = (s: string, e: string) => {
    let n = 0;
    for (let d = dateOf(s); ymdUTC(d) <= e; d = new Date(d.getTime() + 86400000)) { const dow = d.getUTCDay(); if (dow !== 0 && dow !== 6 && !holidays.has(ymdUTC(d))) n++; }
    return n;
  };
  for (const r of okRows) {
    const info = leaveInfo(r.typeCode!)!;
    const wd = workDays(r.startDate, r.endDate);
    if (wd === 0) { r.status = "invalid"; r.message = info.unit === "FULL" ? "기간에 근무일이 없음(주말·공휴일)" : "주말·공휴일에는 반차·반반차를 넣을 수 없음"; continue; }
    if (r.days == null) r.days = info.unit === "HALF" ? 0.5 : info.unit === "QUARTER" ? 0.25 : wd;
  }
  // 중복 — 기존 진행·승인 휴가와 겹침, 파일 안 겹침(하루 미만 유형끼리 같은 날 다른 유형만 허용)
  const ids = [...new Set(okRows.map((r) => r.matched!.userId))];
  const existing = await prisma.leaveRequest.findMany({
    where: { userId: { in: ids }, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: dateOf(maxE) }, endDate: { gte: dateOf(minS) } },
    select: { userId: true, startDate: true, endDate: true, type: true, importBatch: true },
  });
  const accepted: ImportResult[] = [];
  for (const r of okRows) {
    if (r.status !== "ok") continue;
    const hit = existing.find((x) => x.userId === r.matched!.userId && ymdUTC(x.startDate) <= r.endDate && ymdUTC(x.endDate) >= r.startDate);
    if (hit) { r.status = "duplicate"; r.message = `이미 있는 휴가와 겹침(${ymdUTC(hit.startDate)}~${ymdUTC(hit.endDate)} ${leaveLabel(hit.type)}${hit.importBatch ? ", 이전 가져오기" : ""})`; continue; }
    const clash = accepted.find((a) => a.matched!.userId === r.matched!.userId && a.startDate <= r.endDate && a.endDate >= r.startDate
      && !(a.startDate === r.startDate && leaveInfo(a.typeCode!)!.unit !== "FULL" && leaveInfo(r.typeCode!)!.unit !== "FULL" && a.typeCode !== r.typeCode));
    if (clash) { r.status = "duplicate"; r.message = `파일 안 ${clash.i + 2}행(${clash.startDate}~${clash.endDate} ${clash.typeLabel})과 겹침`; continue; }
    accepted.push(r);
  }
  return out;
}

export const IMPORT_MARK_DEDUCTED = "시프티 이관";
export const IMPORT_MARK_RECORD_ONLY = "시프티 이관(차감 없음)";

export type ApplyOutcome = { batch: string | null; applied: number; skipped: number; failedAt: number | null; error: string | null; results: ImportResult[] };

/** 적용 — 미리보기 ok 행만 승인 완료 휴가로 넣고(deduct 면 차감) 배치 id 를 돌려준다. 중간에 실패하면 거기까지 넣은 것을 알린다(되돌리기 가능) */
export async function applyLeaveImport(rows: unknown[], opts: { deduct: boolean }, actor: { userId: string; name: string }): Promise<ApplyOutcome> {
  const preview = await previewLeaveImport(rows);
  const ok = preview.filter((r) => r.status === "ok");
  if (!ok.length) return { batch: null, applied: 0, skipped: preview.length, failedAt: null, error: null, results: preview };
  const batch = `imp_${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
  let applied = 0, failedAt: number | null = null, error: string | null = null;
  for (const r of ok) {
    try {
      await prisma.$transaction(async (tx) => {
        const created = await tx.leaveRequest.create({
          data: {
            userId: r.matched!.userId, type: r.typeCode as never, startDate: dateOf(r.startDate), endDate: dateOf(r.endDate), days: r.days!,
            reason: `[시프티 이관] ${r.reason}`.trim(), status: "APPROVED", approverId: actor.userId, importBatch: batch,
          },
        });
        // 본부 승인 단계 하나 — 목록·연차 대장에 「관리자 승인(시프티 이관)」으로 보이게(대리 등록 #37 과 같은 방식).
        // 차감 여부를 이 단계 comment 에 남긴다 — 되돌리기가 행마다 이것으로 복구 여부를 정한다(감사 로그는 실패를 삼키므로 믿지 않는다, 검증 A)
        await tx.leaveApprovalStep.create({ data: { leaveRequestId: created.id, order: 1, approverRole: "ADMIN", approverId: actor.userId, status: "APPROVED", comment: opts.deduct ? IMPORT_MARK_DEDUCTED : IMPORT_MARK_RECORD_ONLY, decidedAt: new Date() } });
        if (opts.deduct && isLeaveDeductible(r.typeCode!)) await deductLeaveBalance(tx, r.matched!.userId, leaveYearOfLeave(dateOf(r.startDate)), r.days!);
      });
      r.status = "applied"; r.message = "";
      applied++;
    } catch (e) {
      failedAt = r.i; error = e instanceof Error ? e.message : String(e);
      console.error("[leave-import] 적용 실패:", r.i, e);
      break;
    }
  }
  await logAudit({
    actorId: actor.userId, actorName: actor.name, action: "LEAVE_IMPORT", targetType: "LeaveRequest", targetId: batch,
    detail: `시프티 휴가 가져오기 ${batch}: ${applied}건 적용${opts.deduct ? "(연차 차감)" : "(기록만, 차감 없음)"}, ${preview.length - applied}행 건너뜀${failedAt != null ? `, ${failedAt + 2}행에서 실패해 중단` : ""} — ${[...new Set(ok.slice(0, applied).map((r) => r.matched!.name))].slice(0, 10).join(", ")}${applied > 10 ? " 외" : ""}`,
  });
  return { batch: applied ? batch : null, applied, skipped: preview.length - applied, failedAt, error, results: preview };
}

/** 되돌리기 — 배치의 휴가를 지우고 차감을 복구. 진행 중인 취소 요청이 걸린 건은 두고 개수로 알린다 */
export async function rollbackLeaveImport(batch: string, actor: { userId: string; name: string }) {
  const rows = await prisma.leaveRequest.findMany({
    where: { importBatch: batch },
    select: { id: true, userId: true, type: true, days: true, startDate: true, status: true, approvalSteps: { select: { comment: true } }, _count: { select: { cancelRequests: { where: { status: "PENDING" } } } } },
  });
  let removed = 0, kept = 0, restored = 0;
  for (const r of rows) {
    if (r._count.cancelRequests > 0) { kept++; continue; }
    // 「차감 없음」 표식이 없으면 차감한 것으로 보고 복구한다(표식이 없는 쪽으로 기울이지 않는다 — 검증 A)
    const deducted = !r.approvalSteps.some((s) => s.comment === IMPORT_MARK_RECORD_ONLY);
    await prisma.$transaction(async (tx) => {
      await tx.leaveApprovalStep.deleteMany({ where: { leaveRequestId: r.id } });
      await tx.leaveRequest.delete({ where: { id: r.id } });
      if (deducted && r.status === "APPROVED" && isLeaveDeductible(r.type)) { await restoreLeaveBalance(tx, r.userId, leaveYearOfLeave(r.startDate), r.days); restored++; }
    });
    removed++;
  }
  await logAudit({ actorId: actor.userId, actorName: actor.name, action: "LEAVE_IMPORT_ROLLBACK", targetType: "LeaveRequest", targetId: batch, detail: `시프티 휴가 가져오기 되돌리기 ${batch}: ${removed}건 삭제·${restored}건 연차 복구${kept ? `, 취소 요청이 진행 중인 ${kept}건은 둠` : ""}` });
  return { removed, kept, restored };
}

/** 가져온 배치 목록 — 배치별 건수·일수·첫 적용 시각 */
export async function listLeaveImportBatches() {
  const g = await prisma.leaveRequest.groupBy({ by: ["importBatch"], where: { importBatch: { not: null } }, _count: { _all: true }, _sum: { days: true }, _min: { createdAt: true } });
  return g.map((x) => ({ batch: x.importBatch!, count: x._count._all, days: x._sum.days ?? 0, createdAt: x._min.createdAt?.toISOString() ?? null }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
