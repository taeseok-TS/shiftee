import { prisma } from "@/lib/db";
import { logAudit } from "@/lib/audit";
import { asHhmm, toMin } from "@/lib/schedule-payload";
import { guardScheduleChange, noteManagerSelfChange } from "@/lib/schedule-guard";
import { getManagerBranches } from "@/lib/manager-branches";
import { over49Warnings } from "@/lib/weekly-hours";
import { ymdUTC } from "@/lib/holidays";

// ─── 근무일정 엑셀 업로드(2026-10-13 QA76 #75) ───────────────────────────────
// 화면이 달력형(행=직원, 열=날짜, 칸=템플릿 코드·시간)·목록형(행=직원·날짜·시간)을 **같은 모양의 행**으로 바꿔 보낸다.
//  · 직원 매칭: 사번 → 이름(재직·미삭제 중 한 명일 때만). 사번으로 찾았는데 파일 이름과 다르면 건너뛴다(확인 필요)
//  · 시간: 시작·종료가 있으면 그것, 없으면 칸 값(code)을 본다 — 템플릿 코드·이름(그 직원 지점에서 쓸 수 있는 것) / 「10:00-19:00」「10-19」「10:30~19:30」 / 「휴무·OFF·X」 / 「공휴일」
//  · 규칙은 개별·일괄 등록과 같다: 종료>시작, 하루 12시간까지, 승인된 휴가가 있는 날은 건너뜀, 이미 일정이 있는 날은 건너뜀(덮어쓰기를 켜면 바꿈)
//  · 권한: 본부는 전부, 원장은 담당 지점 직원·본인(guardScheduleChange). 파일 안 같은 직원·같은 날 중복은 뒤 행을 건너뛴다
//  · 적용: 미리보기를 서버가 다시 돌린 뒤 새 행은 createMany(importBatch 표식), 덮어쓰기 행은 update. 묶음째 되돌리기(덮어쓴 행은 지워질 뿐 원래 값으로 돌아가지 않는다 — 화면에 안내)
export type ScheduleImportRow = { i?: number; empNo?: string | number | null; name?: string | null; date?: string | null; code?: string | null; startTime?: string | null; endTime?: string | null; type?: string | null; note?: string | null };
export type ScheduleImportStatus = "ok" | "overwrite" | "applied" | "user_not_found" | "user_ambiguous" | "user_mismatch" | "forbidden" | "code_unknown" | "invalid" | "duplicate" | "exists" | "leave";
export type ScheduleImportResult = {
  i: number; name: string; matched: { userId: string; name: string; branch: string | null } | null;
  date: string; code: string; startTime: string | null; endTime: string | null; type: "WORK" | "OFF" | "HOLIDAY" | null; note: string;
  status: ScheduleImportStatus; message: string;
};
type Actor = { userId: string; role: string; name: string };

const norm = (s: string) => s.replace(/[\s()_\-·~]/g, "").toLowerCase();
const str = (v: unknown) => (v == null ? "" : String(v).trim());
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const OFF_RE = /^(휴무|off|x|쉼|휴)$/i;
const HOLIDAY_RE = /^(공휴일|holiday|휴일)$/i;

const toYmd = (v: unknown): string | null => {
  const s = str(v);
  const m = /^(\d{4})[.\-/년 ]\s*(\d{1,2})[.\-/월 ]\s*(\d{1,2})일?/.exec(s);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return ymdUTC(dt);
};
/** 「10:00」「10」「1000」「10:00 AM」「오후 7:00」 → "HH:mm" */
export function parseTime(v: unknown): string | null {
  let s = str(v);
  if (!s) return null;
  let pm = false, am = false;
  if (/pm|오후/i.test(s)) pm = true;
  if (/am|오전/i.test(s)) am = true;
  s = s.replace(/am|pm|오전|오후/gi, "").trim();
  let h: number, m: number;
  let mm = /^(\d{1,2})[:시]\s*(\d{1,2})?분?$/.exec(s);
  if (mm) { h = Number(mm[1]); m = Number(mm[2] ?? 0); }
  else if ((mm = /^(\d{1,2})(\d{2})$/.exec(s))) { h = Number(mm[1]); m = Number(mm[2]); }
  else if ((mm = /^(\d{1,2})$/.exec(s))) { h = Number(mm[1]); m = 0; }
  else return null;
  if (pm && h < 12) h += 12;
  if (am && h === 12) h = 0;
  if (h > 24 || m > 59 || (h === 24 && m > 0)) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
/** 「10:00-19:00」「10-19」「10:30~19:30」「10:00 ~ 19:00」 */
function parseRange(code: string): { st: string; et: string } | null {
  const m = /^(.+?)\s*[-~–]\s*(.+)$/.exec(code);
  if (!m) return null;
  const st = parseTime(m[1]), et = parseTime(m[2]);
  return st && et ? { st, et } : null;
}
function checkTimes(st: string, et: string): string | null {
  if (toMin(et) <= toMin(st)) return "종료 시간이 시작 시간보다 빠릅니다";
  if (toMin(et) - toMin(st) > 12 * 60) return "하루 근무는 12시간을 넘을 수 없습니다";
  return null;
}

type Tpl = { code: string | null; name: string; startTime: string; endTime: string; branches: string[] };
function findTemplate(tpls: Tpl[], text: string, branch: string | null): Tpl | null | "ambiguous" {
  const n = norm(text);
  if (!n) return null;
  const usable = tpls.filter((t) => t.branches.length === 0 || (branch != null && t.branches.includes(branch)));
  const byCode = usable.filter((t) => t.code && norm(t.code) === n);
  if (byCode.length === 1) return byCode[0];
  if (byCode.length > 1) return "ambiguous";
  const byName = usable.filter((t) => norm(t.name) === n);
  if (byName.length === 1) return byName[0];
  if (byName.length > 1) return "ambiguous";
  return null;
}

/** 미리보기 — 행마다 직원·시간·중복·권한을 판정한다(쓰지 않는다) */
export async function previewScheduleImport(rowsIn: unknown[], actor: Actor, overwrite: boolean): Promise<ScheduleImportResult[]> {
  const rows: ScheduleImportRow[] = rowsIn.map((r) => (isObj(r) ? (r as ScheduleImportRow) : {}));
  const [users, tpls] = await Promise.all([
    prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, name: true, empNo: true, branch: true, isActive: true, role: true } }),
    prisma.scheduleTemplate.findMany({ where: { isActive: true }, select: { code: true, name: true, startTime: true, endTime: true, branches: true } }),
  ]);
  const byEmpNo = new Map(users.filter((u) => u.empNo != null).map((u) => [u.empNo as number, u]));
  const byName = new Map<string, typeof users>();
  for (const u of users) { if (!u.isActive) continue; const k = norm(u.name); byName.set(k, [...(byName.get(k) ?? []), u]); }
  const myBranches = actor.role === "MANAGER" ? await getManagerBranches(actor.userId) : undefined;
  const allowed = new Map<string, string | null>();   // userId → 거부 사유(null 이면 허용)

  // 1차: 행마다 직원·시간 해석
  const pass1: ScheduleImportResult[] = [];
  for (const [idx, r] of rows.entries()) {
    const i = typeof r.i === "number" ? r.i : idx;
    const name = str(r.name), code = str(r.code), note = str(r.note).slice(0, 200);
    const base: ScheduleImportResult = { i, name, matched: null, date: toYmd(r.date) ?? str(r.date), code, startTime: null, endTime: null, type: null, note, status: "ok", message: "" };
    // 직원
    let user: (typeof users)[number] | undefined;
    const empNoText = str(r.empNo);
    const empNo = /^\d+$/.test(empNoText) ? Number(empNoText) : 0;
    if (empNo > 0) user = byEmpNo.get(empNo);
    if (user && name && norm(user.name) !== norm(name)) { pass1.push({ ...base, matched: { userId: user.id, name: user.name, branch: user.branch }, status: "user_mismatch", message: `사번으로 찾은 직원(${user.name})과 파일 이름(${name})이 다름 — 확인 필요` }); continue; }
    if (!user && name) {
      const c = byName.get(norm(name)) ?? [];
      if (c.length > 1) { pass1.push({ ...base, status: "user_ambiguous", message: `같은 이름 ${c.length}명 — 사번 열을 넣어 주세요` }); continue; }
      user = c[0];
    }
    if (!user) { pass1.push({ ...base, status: "user_not_found", message: "직원을 찾지 못함(사번·이름)" }); continue; }
    const matched = { userId: user.id, name: user.name, branch: user.branch };
    // 권한(원장은 담당 지점·본인만) — 사람마다 한 번만 확인
    if (!allowed.has(user.id)) allowed.set(user.id, await guardScheduleChange(actor as Parameters<typeof guardScheduleChange>[0], user.id, myBranches));
    const denied = allowed.get(user.id);
    if (denied) { pass1.push({ ...base, matched, status: "forbidden", message: denied }); continue; }
    // 날짜
    const date = toYmd(r.date);
    if (!date) { pass1.push({ ...base, matched, status: "invalid", message: "날짜 형식(예: 2026-10-01)이 잘못됨" }); continue; }
    // 시간·유형
    let st: string | null = null, et: string | null = null, type: "WORK" | "OFF" | "HOLIDAY" = "WORK";
    const typeText = str(r.type).toUpperCase();
    if (typeText === "OFF" || OFF_RE.test(str(r.type))) type = "OFF";
    else if (typeText === "HOLIDAY" || HOLIDAY_RE.test(str(r.type))) type = "HOLIDAY";
    const sIn = asHhmm(parseTime(r.startTime) ?? ""), eIn = asHhmm(parseTime(r.endTime) ?? "");
    if (sIn && eIn) { st = sIn; et = eIn; }
    else if (code) {
      if (OFF_RE.test(code)) type = "OFF";
      else if (HOLIDAY_RE.test(code)) type = "HOLIDAY";
      else {
        const range = parseRange(code);
        if (range) { st = range.st; et = range.et; }
        else {
          const t = findTemplate(tpls, code, user.branch);
          if (t === "ambiguous") { pass1.push({ ...base, matched, date, status: "code_unknown", message: `「${code}」에 맞는 템플릿이 여럿 — 코드를 써 주세요` }); continue; }
          if (!t) { pass1.push({ ...base, matched, date, status: "code_unknown", message: `「${code}」 — 템플릿 코드·이름이나 「10:00-19:00」 형식이어야 합니다` }); continue; }
          st = t.startTime; et = t.endTime;
        }
      }
    }
    if (type === "WORK") {
      if (!st || !et) { pass1.push({ ...base, matched, date, status: "invalid", message: "근무 시간이 없음(시작·종료 또는 템플릿)" }); continue; }
      const bad = checkTimes(st, et);
      if (bad) { pass1.push({ ...base, matched, date, startTime: st, endTime: et, type, status: "invalid", message: bad }); continue; }
    } else {
      // 휴무·공휴일은 시간이 없어도 된다 — 저장 모양을 맞추기 위해 00:00~00:01? 아니다: 기존 규칙(종료>시작)에 맞춰 템플릿/입력 시간이 없으면 09:00~18:00 을 적는다(화면은 유형만 보여 준다)
      if (!st || !et || checkTimes(st, et)) { st = "09:00"; et = "18:00"; }
    }
    pass1.push({ ...base, matched, date, startTime: st, endTime: et, type });
  }

  // 2차: 파일 안 중복, 기존 일정, 승인 휴가
  const okRows = pass1.filter((r) => r.status === "ok" && r.matched);
  const userIds = [...new Set(okRows.map((r) => r.matched!.userId))];
  const dates = okRows.map((r) => r.date).sort();
  let has = new Set<string>(), onLeave = new Set<string>();
  if (okRows.length) {
    const from = new Date(`${dates[0]}T00:00:00Z`), to = new Date(`${dates[dates.length - 1]}T00:00:00Z`);
    const [existing, leaves] = await Promise.all([
      prisma.schedule.findMany({ where: { userId: { in: userIds }, date: { gte: from, lte: to } }, select: { userId: true, date: true } }),
      prisma.leaveRequest.findMany({ where: { userId: { in: userIds }, status: "APPROVED", startDate: { lte: to }, endDate: { gte: from } }, select: { userId: true, startDate: true, endDate: true } }),
    ]);
    has = new Set(existing.map((e) => `${e.userId}|${ymdUTC(e.date)}`));
    onLeave = new Set<string>();
    for (const l of leaves) for (let d = new Date(l.startDate); d <= l.endDate; d.setUTCDate(d.getUTCDate() + 1)) onLeave.add(`${l.userId}|${ymdUTC(d)}`);
  }
  const seen = new Set<string>();
  return pass1.map((r) => {
    if (r.status !== "ok" || !r.matched) return r;
    const k = `${r.matched.userId}|${r.date}`;
    if (seen.has(k)) return { ...r, status: "duplicate", message: "파일 안에 같은 직원·같은 날이 앞에 있음" };
    seen.add(k);
    if (onLeave.has(k)) return { ...r, status: "leave", message: "승인된 휴가가 있는 날" };
    if (has.has(k)) return overwrite ? { ...r, status: "overwrite", message: "이미 있는 일정을 바꿈" } : { ...r, status: "exists", message: "이미 일정이 있음(덮어쓰기를 켜면 바꿈)" };
    return r;
  });
}

const batchId = () => `simp_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${Math.random().toString(36).slice(2, 8)}`;

/** 적용 — 미리보기를 다시 돌려 「적용 예정·덮어쓰기」 행만 넣는다 */
export async function applyScheduleImport(rowsIn: unknown[], actor: Actor, overwrite: boolean) {
  const results = await previewScheduleImport(rowsIn, actor, overwrite);
  const batch = batchId();
  const creates = results.filter((r) => r.status === "ok");
  const updates = results.filter((r) => r.status === "overwrite");
  const dateOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`);
  let applied = 0, overwritten = 0;
  if (creates.length) {
    const made = await prisma.schedule.createMany({
      data: creates.map((r) => ({ userId: r.matched!.userId, date: dateOf(r.date), startTime: r.startTime!, endTime: r.endTime!, type: r.type!, note: r.note || null, importBatch: batch })),
      skipDuplicates: true,   // 미리보기 뒤에 누가 같은 날을 넣었으면 건너뛴다
    });
    applied = made.count;
  }
  for (const r of updates) {
    const u = await prisma.schedule.updateMany({ where: { userId: r.matched!.userId, date: dateOf(r.date) }, data: { startTime: r.startTime!, endTime: r.endTime!, type: r.type!, note: r.note || null, importBatch: batch } });
    overwritten += u.count;
  }
  const touched = [...creates, ...updates];
  const people = [...new Set(touched.map((r) => r.matched!.userId))];
  if (touched.length) {
    await noteManagerSelfChange(actor, people, `엑셀 업로드 ${touched.length}건(묶음 ${batch})`);
    await logAudit({ actorId: actor.userId, actorName: actor.name, action: "SCHEDULE_IMPORT", targetType: "Schedule", targetId: batch, targetName: "근무일정 엑셀 업로드",
      detail: `새로 ${applied}건 · 덮어씀 ${overwritten}건 · 직원 ${people.length}명 · 기간 ${touched.map((r) => r.date).sort()[0]}~${touched.map((r) => r.date).sort().slice(-1)[0]}` });
  }
  const warnings = touched.length ? await over49Warnings(touched.map((r) => ({ userId: r.matched!.userId, date: r.date }))).catch(() => [] as string[]) : [];
  const final = results.map((r) => (r.status === "ok" || r.status === "overwrite" ? { ...r, status: "applied" as const, message: r.status === "overwrite" ? "덮어씀" : "" } : r));
  return { batch: touched.length ? batch : null, applied, overwritten, skipped: results.length - touched.length, warnings, results: final };
}

/** 되돌리기 — 묶음 표식이 붙은 일정을 지운다(원장은 담당 범위 밖이면 거절) */
export async function rollbackScheduleImport(batch: string, actor: Actor) {
  const rows = await prisma.schedule.findMany({ where: { importBatch: batch }, select: { id: true, userId: true, date: true } });
  if (!rows.length) return { removed: 0 };
  const myBranches = actor.role === "MANAGER" ? await getManagerBranches(actor.userId) : undefined;
  for (const uid of [...new Set(rows.map((r) => r.userId))]) {
    const denied = await guardScheduleChange(actor as Parameters<typeof guardScheduleChange>[0], uid, myBranches);
    if (denied) throw new Error(`이 묶음에는 권한 밖 직원의 일정이 있어 되돌릴 수 없습니다: ${denied}`);
  }
  const del = await prisma.schedule.deleteMany({ where: { importBatch: batch } });
  await logAudit({ actorId: actor.userId, actorName: actor.name, action: "SCHEDULE_IMPORT_ROLLBACK", targetType: "Schedule", targetId: batch, targetName: "근무일정 엑셀 업로드 되돌리기", detail: `${del.count}건 지움` });
  return { removed: del.count };
}

export async function listScheduleImportBatches(actor: Actor) {
  // 원장은 담당 지점 직원의 묶음만
  const scope = actor.role === "MANAGER" ? { user: { branch: { in: await getManagerBranches(actor.userId) } } } : {};
  const g = await prisma.schedule.groupBy({ by: ["importBatch"], where: { importBatch: { not: null }, ...scope }, _count: { _all: true }, _min: { date: true, createdAt: true }, _max: { date: true } });
  return g.filter((x) => x.importBatch).sort((a, b) => (b._min.createdAt?.getTime() ?? 0) - (a._min.createdAt?.getTime() ?? 0)).slice(0, 30)
    .map((x) => ({ batch: x.importBatch as string, count: x._count._all, from: x._min.date ? ymdUTC(x._min.date) : null, to: x._max.date ? ymdUTC(x._max.date) : null, createdAt: x._min.createdAt?.toISOString() ?? null }));
}
