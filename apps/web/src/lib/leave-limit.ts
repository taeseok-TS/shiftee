import type { Prisma } from "@prisma/client";
import { yearBalanceFor } from "@/lib/leave-balance";
import { isLeaveDeductible } from "@/lib/leave-types";
import { leaveDaysByYear } from "@/lib/leave-days";
import { groupCodes, groupOfType, type GrantGroup } from "@/lib/leave-grant";

// ─── 잔여 초과 신청 막기 — 판정은 **이 함수 하나**(2026-10-16 #219-7·11) ─────────────────────────
// 쓰는 곳: 신청(api/leave POST — 본인·본부 대리 등록), 신청 창 미리보기(api/leave/days), 최종 승인(api/leave/[id]/approve
// 단계 최종 승인·관리자 직접 처리). 화면과 서버가 같은 판정을 쓰게 미리보기 API 가 이 결과를 그대로 돌려준다.
//  · 연차(isLeaveDeductible 유형): 해마다 그 해 잔여(yearBalanceFor — 화면 「잔여」와 같은 값). 연도를 걸친 휴가(12/31~1/2)는
//    날짜별로 나눠(lib/leave-days leaveDaysByYear — 차감과 같은 나눔, 2026-10-19) 그해 몫은 그해 잔여로, 다음 해 몫은 다음 해 잔여로 본다.
//    결과는 막힌 해(없으면 시작일 해) 하나 — years 에 해마다 판정이 다 들어 있다.
//    그 해 행이 없는 지난 해는 종전처럼 검사하지 않는다(remaining null).
//  · 보상휴가·대체휴일(디렉터 결정 (c) — 10/8 「막지 않음」을 바꿈): 잔여 = 그 그룹 부여 합(LeaveGrant.days 전체, 음수 조정 포함)
//    − 승인된 그 그룹 유형 사용 합. 그룹 유형은 본부가 만든 유형까지(allLeaveTypes) — 호출부가 ensureLeaveCatalog 를 먼저 부른다.
//  · 신청 때는 **결재 대기(PENDING) 신청까지 합산**한다(같은 해·같은 차감 대상). 종전에는 대기분을 안 세어 여러 건을 올리면
//    잔여를 넘길 수 있었다(#219-11). 최종 승인 때는 대기분을 빼고 **지금 잔여만** 본다(다른 대기 건이 승인을 막지 않게).
//  · 반차·반반차도 같은 기준(0.5·0.25일).
// 잔여 숫자를 숨기는 설정(#219-1)이어도 막기는 그대로다 — 문구에서 숫자만 뺀다(limitMessage visible=false).

type Db = Prisma.TransactionClient;
const r2 = (n: number) => Math.round(n * 100) / 100;
const EPS = 1e-9;

export type LeaveLimit =
  | { kind: "none"; blocked: false }
  | ({ kind: "annual" } & AnnualYear & { requestedTotal: number; years: AnnualYear[] })
  | { kind: "grant"; group: GrantGroup; remaining: number; pending: number; requested: number; available: number; blocked: boolean };

/** 연차 한 해 판정 — requested = 이 신청 중 그 해 몫 */
export type AnnualYear = { year: number; remaining: number | null; pending: number; requested: number; available: number | null; blocked: boolean };

export async function checkLeaveLimit(
  db: Db,
  opts: {
    userId: string; type: string; startDate: Date; days: number; includePending: boolean; excludeRequestId?: string;
    /** 종료일 — 연도를 걸친 휴가를 해마다 나눠 본다. 없으면 시작일 하루짜리로 본다 */
    endDate?: Date;
    /** 신청 때 센 근무일로 이미 나눈 해마다 몫(lib/leave-days splitWorkdaysByYear) — 있으면 DB 를 다시 보지 않는다 */
    byYear?: Map<number, number>;
  },
): Promise<LeaveLimit> {
  const { userId, type, startDate, days, includePending, excludeRequestId } = opts;
  const notMe = excludeRequestId ? { id: { not: excludeRequestId } } : {};

  if (isLeaveDeductible(type)) {
    const split = opts.byYear ?? (await leaveDaysByYear(db, { userId, startDate, endDate: opts.endDate ?? startDate, days }));
    const startYear = startDate.getUTCFullYear();
    const years = [...split.keys()].sort((a, b) => a - b);
    if (!years.length) years.push(startYear);
    // 대기 중인 연차 신청 — 그 해에 걸친 것까지 해마다 몫으로(차감과 같은 나눔)
    const pendingBy = new Map<number, number>();
    if (includePending) {
      const lo = years[0], hi = years[years.length - 1];
      const rows = await db.leaveRequest.findMany({
        where: { userId, status: "PENDING", startDate: { lt: new Date(Date.UTC(hi + 1, 0, 1)) }, endDate: { gte: new Date(Date.UTC(lo, 0, 1)) }, ...notMe },
        select: { userId: true, type: true, days: true, startDate: true, endDate: true },
      });
      for (const r of rows) {
        if (!isLeaveDeductible(r.type)) continue;
        for (const [y, d] of await leaveDaysByYear(db, r)) pendingBy.set(y, (pendingBy.get(y) ?? 0) + d);
      }
    }
    const results: AnnualYear[] = [];
    for (const year of years) {
      const want = split.get(year) ?? 0;   // 반올림하지 않는다 — 한 해 안 신청이면 days 그대로(종전 판정과 같다)
      const pending = r2(pendingBy.get(year) ?? 0);   // 종전처럼 합을 한 번 반올림
      const bal = await yearBalanceFor(db, userId, year);
      if (!bal) { results.push({ year, remaining: null, pending, requested: want, available: null, blocked: false }); continue; }
      const remaining = r2(bal.remaining);
      const available = r2(remaining - pending);
      results.push({ year, remaining, pending, requested: want, available, blocked: want > 0 && available + EPS < want });
    }
    const pick = results.find((r) => r.blocked) ?? results.find((r) => r.year === startYear) ?? results[0];
    return { kind: "annual", ...pick, requestedTotal: days, years: results };
  }

  const group = groupOfType(type);
  if (!group) return { kind: "none", blocked: false };
  // 보상·대체 막기는 스위치가 켜졌을 때만(디렉터 10/16 「이관 뒤부터」 — lib/permission-settings leave.blockGrantOverdraw, 기본 끔)
  const { isAllowed } = await import("@/lib/permission-settings");
  const enforce = await isAllowed("leave.blockGrantOverdraw");
  // 막기가 꺼져 있으면 판정 자체를 하지 않는다 — 부여 기록이 없는 지금 음수 잔여가 신청 창에 보이던 것(재검증 4)
  if (!enforce) return { kind: "none", blocked: false };
  const codes = groupCodes(group);
  const [granted, used, pend] = await Promise.all([
    db.leaveGrant.aggregate({ where: { userId, group }, _sum: { days: true } }),
    // 승인된 사용 — 자기 자신은 뺀다(관리자 직접 처리는 상태를 먼저 APPROVED 로 바꾼 뒤 검사해 두 번 세었다, 검증 1)
    db.leaveRequest.aggregate({ where: { userId, status: "APPROVED", type: { in: codes }, ...notMe }, _sum: { days: true } }),
    includePending
      ? db.leaveRequest.aggregate({ where: { userId, status: "PENDING", type: { in: codes }, ...notMe }, _sum: { days: true } })
      : Promise.resolve({ _sum: { days: 0 } }),
  ]);
  const remaining = r2((granted._sum.days ?? 0) - (used._sum.days ?? 0));
  const pending = r2(pend._sum.days ?? 0);
  const available = r2(remaining - pending);
  return { kind: "grant", group, remaining, pending, requested: days, available, blocked: available + EPS < days };
}

/**
 * 막힐 때 문구 — visible=false(잔여 숫자 숨김, #219-1)면 숫자를 말하지 않는다.
 * when: "request" = 신청, "approve" = 최종 승인. who = 본부 대리 등록일 때 대상 직원 이름.
 */
export function limitMessage(l: LeaveLimit, opts: { visible: boolean; when: "request" | "approve"; who?: string; overridable?: boolean }): string {
  if (l.kind === "none") return "";
  const subject = l.kind === "annual" ? "연차" : l.group;
  const prefix = opts.who ? `${opts.who}님의 ` : "";
  if (opts.when === "approve") {
    const nums = opts.visible
      ? (l.kind === "annual" ? ` (${l.year}년 잔여 ${l.remaining ?? "-"}일, 이 신청 ${askText(l)})` : ` (${l.group} 잔여 ${l.remaining}일, 이 신청 ${l.requested}일)`)
      : "";
    // overridable = 본부(관리자)가 한 번 더 확인하면 예외 승인할 수 있다(2026-10-22 본부 요청) — 「승인할 수 없습니다」 대신 「부족합니다」
    return `${prefix}${subject} 잔여가 ${opts.overridable ? "부족합니다." : "부족해 승인할 수 없습니다."}${nums}`;
  }
  if (!opts.visible) {
    return `${prefix}${subject} 잔여가 부족해 신청할 수 없습니다${l.pending > 0 ? "(결재 대기 중인 신청 포함)" : ""}. 남은 일수는 연차 정리 중이라 본부에 문의해 주세요.`;
  }
  const head = l.kind === "annual" ? `${l.year}년 잔여 ${l.remaining}일` : `${l.group} 잔여 ${l.remaining}일`;
  return `${prefix}${subject} 잔여가 부족합니다. (${head}${l.pending > 0 ? `, 결재 대기 ${l.pending}일` : ""}, 신청 ${l.kind === "annual" ? askText(l) : `${l.requested}일`})`;
}

/** 연도를 걸친 신청이면 「2일 중 2027년 몫 1일」, 아니면 「2일」 */
function askText(l: Extract<LeaveLimit, { kind: "annual" }>): string {
  return l.requested !== l.requestedTotal ? `${l.requestedTotal}일 중 ${l.year}년 몫 ${l.requested}일` : `${l.requested}일`;
}
