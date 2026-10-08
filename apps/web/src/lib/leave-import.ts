import { prisma } from "@/lib/db";
import { LEAVE_CATALOG, leaveInfo, leaveLabel } from "@/lib/leave-catalog";
import { isLeaveDeductible } from "@/lib/leave-types";
import { leaveYearOfLeave } from "@/lib/leave-calc";
import { deductLeaveBalance, restoreLeaveBalance } from "@/lib/leave-balance";
import { getHolidaySet, ymdUTC } from "@/lib/holidays";
import { logAudit } from "@/lib/audit";

// ─── 시프티 휴가 사용 내역 가져오기(2026-10-08 QA76 #2) ─────────────────────
// 본부가 시프티에서 내려받은 엑셀(열 구성은 화면에서 맞춘다)을 직원·유형과 대조해 **승인 완료** 휴가로 넣는다.
//  · 직원 매칭: 사번 → 이메일 → 이름(재직·미삭제 중 한 명일 때만). 동명이인은 건너뛴다
//  · 유형 매칭: 큐브티 유형 이름과 시프티 이름(별칭표). 못 맞추면 화면에서 골라 준다(typeOverride)
//  · 일수: 파일에 있으면 그 값, 없으면 휴가 신청과 같은 규칙(반차 0.5·반반차 0.25·그 밖은 주말·공휴일 뺀 근무일)
//  · 중복: 같은 직원의 진행·승인 휴가와 날짜가 겹치면 건너뛴다. 파일 안 같은 행도 건너뛴다
//  · 적용: status APPROVED, 사유 앞에 「[시프티 이관]」, importBatch 로 묶는다. 연차 차감 유형은 그 해 연차에서 차감
//  · 되돌리기: 배치의 휴가를 지우고 차감을 복구한다(취소 요청이 걸린 건은 두고 알린다)
export type ImportRow = { empNo?: string | number | null; name?: string | null; email?: string | null; type?: string | null; startDate?: string | null; endDate?: string | null; days?: string | number | null; reason?: string | null; typeOverride?: string | null };
export type ImportResult = {
  i: number; name: string; matched: { userId: string; name: string; branch: string | null } | null;
  typeText: string; typeCode: string | null; typeLabel: string | null; startDate: string; endDate: string; days: number | null; reason: string;
  status: "ok" | "user_not_found" | "user_ambiguous" | "type_unknown" | "invalid" | "duplicate"; message: string;
};

const ALIASES: Record<string, string> = {
  "반차": "HALF_AM", "오전반차": "HALF_AM", "오후반차": "HALF_PM", "반반차": "QUARTER_AM", "오전반반차": "QUARTER_AM", "오후반반차": "QUARTER_PM",
  "연차휴가": "ANNUAL", "연차": "ANNUAL", "대체휴무": "COMPENSATORY", "대체휴무반차": "COMPENSATORY_HALF", "대체휴일반차": "COMPENSATORY_HALF", "보상휴가반차": "COMP_LEAVE_HALF",
  "민방위": "CIVIL_DEFENSE", "민방위휴가": "CIVIL_DEFENSE", "예비군": "RESERVE_FORCES", "예비군휴가": "RESERVE_FORCES", "예비군훈련": "RESERVE_FORCES",
  "기타휴가유급": "OTHER_PAID", "기타휴가무급": "OTHER_UNPAID", "무급휴가": "OTHER_UNPAID", "경조사": "FAMILY_EVENT", "경조": "FAMILY_EVENT", "병가": "SICK",
};
const norm = (s: string) => s.replace(/[\s()_\-·]/g, "").toLowerCase();
const BY_LABEL = new Map(LEAVE_CATALOG.map((t) => [norm(t.label), t.code]));
const CODES = new Set(LEAVE_CATALOG.map((t) => t.code));

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

/** 미리보기 — 행마다 직원·유형·일수·중복을 판정한다(쓰지 않는다) */
export async function previewLeaveImport(rows: ImportRow[]): Promise<ImportResult[]> {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true, empNo: true, branch: true, isActive: true },
  });
  const byEmpNo = new Map(users.filter((u) => u.empNo != null).map((u) => [u.empNo as number, u]));
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const byName = new Map<string, typeof users>();
  for (const u of users) { if (!u.isActive) continue; const k = u.name.trim(); byName.set(k, [...(byName.get(k) ?? []), u]); }

  const out: ImportResult[] = rows.map((r, i) => {
    const name = String(r.name ?? "").trim();
    const typeText = String(r.type ?? "").trim();
    const reason = String(r.reason ?? "").trim();
    const base = { i, name, matched: null, typeText, typeCode: null, typeLabel: null, startDate: toYmd(r.startDate) ?? String(r.startDate ?? ""), endDate: toYmd(r.endDate ?? r.startDate) ?? String(r.endDate ?? ""), days: null, reason };
    // 직원
    let user: (typeof users)[number] | undefined;
    const empNo = Number(String(r.empNo ?? "").replace(/[^0-9]/g, ""));
    if (empNo > 0) user = byEmpNo.get(empNo);
    if (!user && r.email) user = byEmail.get(String(r.email).trim().toLowerCase());
    if (!user && name) {
      const c = byName.get(name) ?? [];
      if (c.length > 1) return { ...base, status: "user_ambiguous", message: `같은 이름 ${c.length}명 — 사번이나 이메일 열을 넣어 주세요` };
      user = c[0];
    }
    if (!user) return { ...base, status: "user_not_found", message: "직원을 찾지 못함(사번·이메일·이름)" };
    const matched = { userId: user.id, name: user.name, branch: user.branch };
    // 유형
    const typeCode = (r.typeOverride && CODES.has(r.typeOverride) ? r.typeOverride : null) ?? resolveLeaveType(typeText);
    if (!typeCode) return { ...base, matched, status: "type_unknown", message: `유형 「${typeText || "(비어 있음)"}」을 큐브티 유형에 맞춰 주세요` };
    const info = leaveInfo(typeCode)!;
    const typed = { ...base, matched, typeCode, typeLabel: leaveLabel(typeCode) };
    // 날짜
    const s = toYmd(r.startDate), e = toYmd(r.endDate ?? r.startDate);
    if (!s || !e || s > e) return { ...typed, status: "invalid", message: "날짜 형식(예: 2026-05-01) 또는 순서가 잘못됨" };
    if (info.unit !== "FULL" && s !== e) return { ...typed, startDate: s, endDate: e, status: "invalid", message: `${info.label}은(는) 하루만` };
    if ((dateOf(e).getTime() - dateOf(s).getTime()) / 86400000 > 366) return { ...typed, startDate: s, endDate: e, status: "invalid", message: "기간이 1년을 넘음" };
    const daysIn = r.days == null || String(r.days).trim() === "" ? null : Number(r.days);
    if (daysIn != null && (!Number.isFinite(daysIn) || daysIn <= 0 || daysIn > 366)) return { ...typed, startDate: s, endDate: e, status: "invalid", message: "일수가 올바르지 않음" };
    return { ...typed, startDate: s, endDate: e, days: daysIn, status: "ok", message: "" };
  });

  // 일수 계산(파일에 없을 때) — 주말·공휴일 뺀 근무일. 공휴일은 전체 범위를 한 번에 읽는다
  const okRows = out.filter((r) => r.status === "ok");
  if (okRows.length) {
    const minS = okRows.map((r) => r.startDate).sort()[0], maxE = okRows.map((r) => r.endDate).sort().at(-1)!;
    const holidays = await getHolidaySet(dateOf(minS), dateOf(maxE));
    for (const r of okRows) {
      const info = leaveInfo(r.typeCode!)!;
      if (r.days == null) {
        if (info.unit === "HALF") r.days = 0.5;
        else if (info.unit === "QUARTER") r.days = 0.25;
        else {
          let n = 0;
          for (let d = dateOf(r.startDate); ymdUTC(d) <= r.endDate; d = new Date(d.getTime() + 86400000)) {
            const dow = d.getUTCDay();
            if (dow !== 0 && dow !== 6 && !holidays.has(ymdUTC(d))) n++;
          }
          r.days = n;
        }
      }
      if (!r.days) { r.status = "invalid"; r.message = "기간에 근무일이 없음(주말·공휴일)"; }
    }
    // 중복 — 기존 진행·승인 휴가와 겹침, 파일 안 같은 행
    const ids = [...new Set(okRows.map((r) => r.matched!.userId))];
    const existing = await prisma.leaveRequest.findMany({
      where: { userId: { in: ids }, status: { in: ["PENDING", "APPROVED"] }, startDate: { lte: dateOf(maxE) }, endDate: { gte: dateOf(minS) } },
      select: { userId: true, startDate: true, endDate: true, type: true, importBatch: true },
    });
    const seen = new Set<string>();
    for (const r of okRows) {
      if (r.status !== "ok") continue;
      const key = `${r.matched!.userId}|${r.startDate}|${r.endDate}|${r.typeCode}`;
      if (seen.has(key)) { r.status = "duplicate"; r.message = "파일 안에 같은 행이 또 있음"; continue; }
      seen.add(key);
      const hit = existing.find((x) => x.userId === r.matched!.userId && ymdUTC(x.startDate) <= r.endDate && ymdUTC(x.endDate) >= r.startDate);
      if (hit) { r.status = "duplicate"; r.message = `이미 있는 휴가와 겹침(${ymdUTC(hit.startDate)}~${ymdUTC(hit.endDate)} ${leaveLabel(hit.type)}${hit.importBatch ? ", 이전 가져오기" : ""})`; }
    }
  }
  return out;
}

/** 적용 — 미리보기 ok 행만 승인 완료 휴가로 넣고 차감한다. 배치 id 를 돌려준다 */
export async function applyLeaveImport(rows: ImportRow[], actor: { userId: string; name: string }) {
  const preview = await previewLeaveImport(rows);
  const ok = preview.filter((r) => r.status === "ok");
  if (!ok.length) return { batch: null, applied: 0, skipped: preview.length, results: preview };
  const batch = `imp_${new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, "")}_${Math.random().toString(36).slice(2, 8)}`;
  let applied = 0;
  for (const r of ok) {
    await prisma.$transaction(async (tx) => {
      await tx.leaveRequest.create({
        data: {
          userId: r.matched!.userId, type: r.typeCode as never, startDate: dateOf(r.startDate), endDate: dateOf(r.endDate), days: r.days!,
          reason: `[시프티 이관] ${r.reason}`.trim(), status: "APPROVED", approverId: actor.userId, importBatch: batch,
        },
      });
      if (isLeaveDeductible(r.typeCode!)) await deductLeaveBalance(tx, r.matched!.userId, leaveYearOfLeave(dateOf(r.startDate)), r.days!);
    });
    applied++;
  }
  await logAudit({
    actorId: actor.userId, actorName: actor.name, action: "LEAVE_IMPORT", targetType: "LeaveRequest", targetId: batch,
    detail: `시프티 휴가 가져오기 ${batch}: ${applied}건 적용, ${preview.length - applied}행 건너뜀 — ${[...new Set(ok.map((r) => r.matched!.name))].slice(0, 10).join(", ")}${ok.length > 10 ? " 외" : ""}`,
  });
  return { batch, applied, skipped: preview.length - applied, results: preview };
}

/** 되돌리기 — 배치의 휴가를 지우고 차감을 복구. 취소 요청이 걸린 건은 두고 개수로 알린다 */
export async function rollbackLeaveImport(batch: string, actor: { userId: string; name: string }) {
  const rows = await prisma.leaveRequest.findMany({
    where: { importBatch: batch },
    select: { id: true, userId: true, type: true, days: true, startDate: true, status: true, _count: { select: { cancelRequests: true } } },
  });
  let removed = 0, kept = 0;
  for (const r of rows) {
    if (r._count.cancelRequests > 0) { kept++; continue; }
    await prisma.$transaction(async (tx) => {
      await tx.leaveApprovalStep.deleteMany({ where: { leaveRequestId: r.id } });
      await tx.leaveRequest.delete({ where: { id: r.id } });
      if (r.status === "APPROVED" && isLeaveDeductible(r.type)) await restoreLeaveBalance(tx, r.userId, leaveYearOfLeave(r.startDate), r.days);
    });
    removed++;
  }
  await logAudit({ actorId: actor.userId, actorName: actor.name, action: "LEAVE_IMPORT_ROLLBACK", targetType: "LeaveRequest", targetId: batch, detail: `시프티 휴가 가져오기 되돌리기 ${batch}: ${removed}건 삭제·복구${kept ? `, 취소 요청이 걸린 ${kept}건은 둠` : ""}` });
  return { removed, kept };
}

/** 가져온 배치 목록 — 배치별 건수·일수·첫 적용 시각 */
export async function listLeaveImportBatches() {
  const g = await prisma.leaveRequest.groupBy({ by: ["importBatch"], where: { importBatch: { not: null } }, _count: { _all: true }, _sum: { days: true }, _min: { createdAt: true } });
  return g.map((x) => ({ batch: x.importBatch!, count: x._count._all, days: x._sum.days ?? 0, createdAt: x._min.createdAt?.toISOString() ?? null }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
